"""Pipeline orchestrator — runs steps in order with gate logic, dependency awareness, and event streaming."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Callable

from mindarchive.config.constants import (
    ALL_STEPS,
    CONDITIONALLY_SKIPPABLE_STEPS,
    STEP_DEPENDENCIES,
)
from mindarchive.notifications.base import NotificationManager
from mindarchive.pipeline.prompt_manager import STEP_NAMES
from mindarchive.pipeline.step_base import PipelineStep, StepContext, StepOutput
from mindarchive.services.cost_tracker import CostTracker

logger = logging.getLogger(__name__)


class RunMode(str, Enum):
    """Pipeline execution modes."""

    AUTO = "auto"              # Run all steps without stopping
    GATE = "gate"              # Pause after EVERY step for approval
    PHASE_GATE = "phase_gate"  # Pause at phase boundaries


# Phase boundaries — steps after which we pause in phase_gate mode
PHASE_GATES: set[int] = {
    9,   # End of pre-production creative
    13,  # End of pre-production technical
}


@dataclass
class PipelineEvent:
    """Event emitted during pipeline execution for UI streaming."""

    event_type: str  # step_start, step_complete, step_skip, step_error, gate_pause, run_complete, run_error, cost_update
    step_number: int | None = None
    step_name: str = ""
    data: dict[str, Any] = field(default_factory=dict)
    message: str = ""


EventCallback = Callable[[PipelineEvent], Any]


class PipelineOrchestrator:
    """Executes the 15-step pipeline with configurable run modes.

    Responsibilities:
    - Step sequencing respecting dependency graph
    - Gate/pause logic based on run mode
    - Event streaming for CLI/web UI
    - Cost tracking across all steps
    - Notification dispatch at milestones
    - Artifact passing between steps
    """

    def __init__(
        self,
        steps: dict[int, PipelineStep],
        mode: RunMode = RunMode.PHASE_GATE,
        cost_tracker: CostTracker | None = None,
        notifier: NotificationManager | None = None,
        event_callback: EventCallback | None = None,
    ) -> None:
        self._steps = steps
        self._mode = mode
        self._cost_tracker = cost_tracker or CostTracker()
        self._notifier = notifier or NotificationManager()
        self._event_cb = event_callback

        # Runtime state
        self._artifacts: dict[int, Any] = {}
        self._results: dict[int, StepOutput] = {}
        self._paused_at: int | None = None
        self._cancelled = False

    @property
    def artifacts(self) -> dict[int, Any]:
        return dict(self._artifacts)

    @property
    def results(self) -> dict[int, StepOutput]:
        return dict(self._results)

    @property
    def paused_at(self) -> int | None:
        return self._paused_at

    def cancel(self) -> None:
        """Request cancellation of the current run."""
        self._cancelled = True

    async def run(
        self,
        context: StepContext,
        step_range: tuple[int, int] | None = None,
    ) -> dict[int, StepOutput]:
        """Execute the pipeline for the given context.

        Args:
            context: The step context with topic, profile, format, etc.
            step_range: Optional (start, end) to run a subset of steps.

        Returns:
            Dict of step_number → StepOutput for all executed steps.
        """
        start = step_range[0] if step_range else 1
        end = step_range[1] if step_range else 15

        steps_to_run = [s for s in ALL_STEPS if start <= s <= end]

        self._emit(PipelineEvent(
            event_type="run_start",
            message=f"Starting pipeline: steps {start}-{end}, mode={self._mode.value}",
            data={"mode": self._mode.value, "steps": steps_to_run},
        ))

        for step_num in steps_to_run:
            if self._cancelled:
                logger.info("Pipeline cancelled at step %d", step_num)
                break

            # Check dependencies
            await self._wait_for_dependencies(step_num)

            # Get step implementation
            step = self._steps.get(step_num)
            if step is None:
                logger.warning("Step %d not implemented, skipping", step_num)
                self._results[step_num] = StepOutput(
                    step_number=step_num,
                    step_name=STEP_NAMES.get(step_num, f"Step {step_num}"),
                    status="skipped",
                    summary="Not yet implemented",
                )
                self._emit(PipelineEvent(
                    event_type="step_skip",
                    step_number=step_num,
                    step_name=STEP_NAMES.get(step_num, ""),
                    message=f"Step {step_num} not implemented",
                ))
                continue

            # Inject artifacts from previous steps
            context.artifacts = dict(self._artifacts)
            context.step_number = step_num

            # Emit start event
            self._emit(PipelineEvent(
                event_type="step_start",
                step_number=step_num,
                step_name=step.step_name,
                message=f"Starting Step {step_num}: {step.step_name}",
            ))

            # Execute
            output = await step.execute(context)
            self._results[step_num] = output

            # Store artifact for downstream steps
            if output.is_success and output.content:
                self._artifacts[step_num] = output.content
            if output.is_success and output.structured_data:
                self._artifacts[step_num] = output.structured_data

            # Track costs
            if output.llm_response:
                resp = output.llm_response
                cost = await self._estimate_llm_cost(resp.input_tokens, resp.output_tokens, context.model)
                self._cost_tracker.log(
                    service="anthropic",
                    operation=f"step_{step_num:02d}",
                    estimated_usd=cost,
                    units=resp.input_tokens + resp.output_tokens,
                    unit_type="tokens",
                    step_number=step_num,
                )

            # Emit result event
            if output.status == "error":
                self._emit(PipelineEvent(
                    event_type="step_error",
                    step_number=step_num,
                    step_name=step.step_name,
                    message=f"Step {step_num} failed: {output.error}",
                    data={"error": output.error or ""},
                ))
                await self._notifier.notify_error(step_num, step.step_name, output.error or "Unknown error")

                # Stop on error in non-auto modes
                if self._mode != RunMode.AUTO:
                    break
            elif output.status == "skipped":
                self._emit(PipelineEvent(
                    event_type="step_skip",
                    step_number=step_num,
                    step_name=step.step_name,
                    message=f"Step {step_num} skipped: {output.summary}",
                ))
            else:
                self._emit(PipelineEvent(
                    event_type="step_complete",
                    step_number=step_num,
                    step_name=step.step_name,
                    message=f"Step {step_num} complete",
                    data={
                        "summary": output.summary,
                        "quality_score": output.quality_score,
                        "artifact": output.artifact_name,
                    },
                ))
                await self._notifier.notify_step_complete(
                    step_num, step.step_name, output.summary
                )

            # Budget check
            if self._cost_tracker.budget_warning:
                await self._notifier.notify_budget_warning(
                    self._cost_tracker.total_actual or self._cost_tracker.total_estimated,
                    self._cost_tracker._budget_cap or 0.0,
                )
                self._emit(PipelineEvent(
                    event_type="cost_update",
                    message="Budget warning threshold reached",
                    data=self._cost_tracker.summary(),
                ))

            # Gate check
            if self._should_gate(step_num) and output.is_success:
                self._paused_at = step_num
                self._emit(PipelineEvent(
                    event_type="gate_pause",
                    step_number=step_num,
                    step_name=step.step_name,
                    message=f"Paused at gate after Step {step_num}: {step.step_name}",
                    data={"summary": output.summary},
                ))
                await self._notifier.notify_gate_pause(step_num, step.step_name, output.summary)
                break  # Pause — will be resumed via resume()

        # If we completed all steps
        if not self._paused_at and not self._cancelled:
            self._emit(PipelineEvent(
                event_type="run_complete",
                message="Pipeline complete",
                data={
                    "cost_summary": self._cost_tracker.summary(),
                    "steps_completed": len([r for r in self._results.values() if r.is_success]),
                },
            ))

        return self._results

    async def resume(
        self,
        context: StepContext,
        decision: str = "approved",
        adjustment: str | None = None,
    ) -> dict[int, StepOutput]:
        """Resume a paused pipeline from the next step after the gate.

        Args:
            context: Step context (may have updated artifacts from adjustment).
            decision: "approved", "rejected", or "adjusted".
            adjustment: Optional adjustment text (re-runs the gated step with this).
        """
        if self._paused_at is None:
            raise ValueError("Pipeline is not paused")

        resume_from = self._paused_at + 1
        self._paused_at = None

        if decision == "rejected":
            self._emit(PipelineEvent(
                event_type="run_complete",
                message=f"Pipeline stopped — Step {resume_from - 1} rejected",
            ))
            return self._results

        if decision == "adjusted" and adjustment:
            # Re-run the gated step with the adjustment
            context.extra_vars["adjustment"] = adjustment
            resume_from = resume_from - 1  # Re-run the same step

        return await self.run(context, step_range=(resume_from, 15))

    async def rerun_step(
        self,
        step_number: int,
        context: StepContext,
    ) -> StepOutput:
        """Re-run a single step (for version iteration)."""
        step = self._steps.get(step_number)
        if step is None:
            raise ValueError(f"Step {step_number} not implemented")

        context.artifacts = dict(self._artifacts)
        context.step_number = step_number
        output = await step.execute(context)

        self._results[step_number] = output
        if output.is_success and (output.content or output.structured_data):
            self._artifacts[step_number] = output.structured_data or output.content

        return output

    def _should_gate(self, step_number: int) -> bool:
        """Check if we should pause at a gate after this step."""
        if self._mode == RunMode.AUTO:
            return False
        if self._mode == RunMode.GATE:
            return True
        if self._mode == RunMode.PHASE_GATE:
            return step_number in PHASE_GATES
        return False

    async def _wait_for_dependencies(self, step_number: int) -> None:
        """Wait for all dependent steps to complete (for future parallel execution)."""
        deps = STEP_DEPENDENCIES.get(step_number, [])
        for dep in deps:
            if dep not in self._results:
                logger.debug(
                    "Step %d waiting for dependency step %d (not yet run)", step_number, dep
                )

    async def _estimate_llm_cost(self, input_tokens: int, output_tokens: int, model: str) -> float:
        """Quick cost estimate for LLM usage."""
        from mindarchive.services.cost_tracker import RATES

        if "opus" in model:
            return (input_tokens / 1_000_000) * RATES.claude_opus_input_per_1m + \
                   (output_tokens / 1_000_000) * RATES.claude_opus_output_per_1m
        return (input_tokens / 1_000_000) * RATES.claude_sonnet_input_per_1m + \
               (output_tokens / 1_000_000) * RATES.claude_sonnet_output_per_1m

    def _emit(self, event: PipelineEvent) -> None:
        """Emit an event to the callback (CLI or web UI)."""
        logger.info("[%s] %s", event.event_type, event.message)
        if self._event_cb:
            self._event_cb(event)
