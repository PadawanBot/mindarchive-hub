"""Step 6: Stock + AI Blend Curator — determines asset mix and search keywords."""

from __future__ import annotations

from typing import Any

from mindarchive.pipeline.step_base import LLMStep, StepContext, StepOutput
from mindarchive.providers.base import LLMResponse


class BlendCurator(LLMStep):
    """Curates the mix of DALL-E, stock, Runway, and motion graphics per scene."""

    def __init__(self, llm: Any, prompt_manager: Any) -> None:
        super().__init__(step_number=6, llm=llm, prompt_manager=prompt_manager)

    def validate_inputs(self, ctx: StepContext) -> list[str]:
        if 5 not in ctx.artifacts:
            return ["Step 5 (Visual Direction) output required"]
        return []

    def _build_prompt_variables(self, ctx: StepContext) -> dict[str, Any]:
        return {
            "scenes": ctx.artifacts.get(5, ""),
        }

    def _process_response(self, response: LLMResponse, ctx: StepContext) -> StepOutput:
        return StepOutput(
            step_number=self.step_number,
            step_name=self.step_name,
            status="complete",
            artifact_name="blend_plan.md",
            content=response.text,
            summary="Asset blend plan generated with search keywords and ratios",
        )
