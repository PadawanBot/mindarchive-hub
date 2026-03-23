"""Step 11: Retention Structure Designer — maps engagement curve checkpoints."""

from __future__ import annotations

from typing import Any

from mindarchive.pipeline.step_base import LLMStep, StepContext, StepOutput
from mindarchive.providers.base import LLMResponse


class RetentionDesigner(LLMStep):
    """Designs the engagement curve with visual/auditory intensity mapping."""

    def __init__(self, llm: Any, prompt_manager: Any) -> None:
        super().__init__(step_number=11, llm=llm, prompt_manager=prompt_manager)

    def validate_inputs(self, ctx: StepContext) -> list[str]:
        errors = []
        if 8 not in ctx.artifacts:
            errors.append("Step 8 (Script Edit Loop) output required")
        if 9 not in ctx.artifacts:
            errors.append("Step 9 (Timing Sync) output required")
        return errors

    def _build_prompt_variables(self, ctx: StepContext) -> dict[str, Any]:
        return {
            "script": ctx.artifacts.get(8, ""),
            "timing": ctx.artifacts.get(9, ""),
        }

    def _process_response(self, response: LLMResponse, ctx: StepContext) -> StepOutput:
        return StepOutput(
            step_number=self.step_number,
            step_name=self.step_name,
            status="complete",
            artifact_name="retention_curve.md",
            content=response.text,
            summary="Engagement curve mapped with retention checkpoints",
        )
