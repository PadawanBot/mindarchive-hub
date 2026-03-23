"""Step 12: Comment Magnet Script Finisher — writes outro and pinned comments."""

from __future__ import annotations

from typing import Any

from mindarchive.pipeline.step_base import LLMStep, StepContext, StepOutput
from mindarchive.providers.base import LLMResponse


class CommentMagnet(LLMStep):
    """Generates outro variations, pinned comments, and engagement CTAs."""

    def __init__(self, llm: Any, prompt_manager: Any) -> None:
        super().__init__(step_number=12, llm=llm, prompt_manager=prompt_manager)

    def validate_inputs(self, ctx: StepContext) -> list[str]:
        if 8 not in ctx.artifacts:
            return ["Step 8 (Script Edit Loop) output required"]
        return []

    def _build_prompt_variables(self, ctx: StepContext) -> dict[str, Any]:
        return {"script": ctx.artifacts.get(8, "")}

    def _process_response(self, response: LLMResponse, ctx: StepContext) -> StepOutput:
        return StepOutput(
            step_number=self.step_number,
            step_name=self.step_name,
            status="complete",
            artifact_name="comment_magnet.md",
            content=response.text,
            summary="Outro variations + pinned comment templates generated",
        )
