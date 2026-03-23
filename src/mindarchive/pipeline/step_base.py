"""Pipeline step base class — lifecycle, quality checks, artifact management."""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from mindarchive.pipeline.prompt_manager import STEP_NAMES
from mindarchive.providers.base import LLMResponse

logger = logging.getLogger(__name__)


@dataclass
class StepContext:
    """Everything a step needs to execute — injected by the orchestrator."""

    # Core identifiers
    project_slug: str
    topic: str
    step_number: int

    # Profile + format data (dict form for template rendering)
    profile: dict[str, Any]
    format_preset: dict[str, Any]

    # Output directory for this project
    output_dir: Path

    # Artifacts from previous steps (step_number → artifact content/path)
    artifacts: dict[int, Any] = field(default_factory=dict)

    # Extra variables for prompt rendering
    extra_vars: dict[str, Any] = field(default_factory=dict)

    # Model override
    model: str = "claude-sonnet-4-6"

    @property
    def step_name(self) -> str:
        return STEP_NAMES.get(self.step_number, f"Step {self.step_number}")


@dataclass
class StepOutput:
    """Result from executing a step."""

    step_number: int
    step_name: str
    status: str  # complete, skipped, error, paused
    artifact_name: str | None = None
    artifact_path: str | None = None
    content: str = ""
    structured_data: dict[str, Any] | None = None
    summary: str = ""
    quality_score: float | None = None
    quality_notes: str = ""
    llm_response: LLMResponse | None = None
    error: str | None = None

    @property
    def is_success(self) -> bool:
        return self.status in ("complete", "skipped")


class PipelineStep(ABC):
    """Base class for all pipeline steps.

    Lifecycle:
    1. should_skip() — check if step should be skipped
    2. validate_inputs() — check prerequisites
    3. execute() — run the step (calls _run internally)
    4. validate_output() — quality check on result
    """

    def __init__(self, step_number: int) -> None:
        self.step_number = step_number
        self.step_name = STEP_NAMES.get(step_number, f"Step {step_number}")

    def should_skip(self, ctx: StepContext) -> str | None:
        """Return skip reason if this step should be skipped, else None."""
        return None

    def validate_inputs(self, ctx: StepContext) -> list[str]:
        """Validate that all required inputs are available.

        Returns list of error messages (empty = valid).
        """
        return []

    async def execute(self, ctx: StepContext) -> StepOutput:
        """Execute the step with full lifecycle management."""
        # Check skip
        skip_reason = self.should_skip(ctx)
        if skip_reason:
            logger.info("Step %d skipped: %s", self.step_number, skip_reason)
            return StepOutput(
                step_number=self.step_number,
                step_name=self.step_name,
                status="skipped",
                summary=skip_reason,
            )

        # Validate inputs
        errors = self.validate_inputs(ctx)
        if errors:
            error_msg = "; ".join(errors)
            logger.error("Step %d input validation failed: %s", self.step_number, error_msg)
            return StepOutput(
                step_number=self.step_number,
                step_name=self.step_name,
                status="error",
                error=f"Input validation failed: {error_msg}",
            )

        # Run the step
        try:
            output = await self._run(ctx)
        except Exception as e:
            logger.exception("Step %d failed: %s", self.step_number, e)
            return StepOutput(
                step_number=self.step_number,
                step_name=self.step_name,
                status="error",
                error=str(e),
            )

        # Validate output
        quality = self.validate_output(output, ctx)
        if quality:
            output.quality_score = quality.get("score")
            output.quality_notes = quality.get("notes", "")

        return output

    @abstractmethod
    async def _run(self, ctx: StepContext) -> StepOutput:
        """Internal step execution — implemented by each step."""
        ...

    def validate_output(self, output: StepOutput, ctx: StepContext) -> dict[str, Any] | None:
        """Optional quality validation on step output. Returns score dict or None."""
        return None


class LLMStep(PipelineStep):
    """Base class for steps that call the LLM (most pre-production steps).

    Subclasses only need to implement:
    - _build_prompt_variables() — extra variables for this step
    - _process_response() — parse LLM response into StepOutput
    """

    def __init__(
        self,
        step_number: int,
        llm: Any,  # AnthropicLLM
        prompt_manager: Any,  # PromptManager
    ) -> None:
        super().__init__(step_number)
        self._llm = llm
        self._prompts = prompt_manager

    def _build_prompt_variables(self, ctx: StepContext) -> dict[str, Any]:
        """Override to add step-specific template variables."""
        return {}

    @abstractmethod
    def _process_response(self, response: LLMResponse, ctx: StepContext) -> StepOutput:
        """Parse the LLM response into a structured StepOutput."""
        ...

    async def _run(self, ctx: StepContext) -> StepOutput:
        """Execute LLM call with prompt rendering."""
        # Build variables
        extra = self._build_prompt_variables(ctx)
        variables = self._prompts.build_variables(
            topic=ctx.topic,
            profile_data=ctx.profile,
            format_data=ctx.format_preset,
            extra={**ctx.extra_vars, **extra},
        )

        # Get prompts
        system_prompt = self._prompts.get_system_prompt(ctx.profile.get("slug"))
        user_prompt = self._prompts.get_prompt(
            self.step_number, variables, ctx.profile.get("slug")
        )

        # Call LLM
        response = await self._llm.generate(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            model=ctx.model,
        )

        # Process response
        output = self._process_response(response, ctx)
        output.llm_response = response
        return output
