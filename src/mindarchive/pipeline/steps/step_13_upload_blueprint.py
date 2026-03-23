"""Step 13: Upload Optimization Blueprint — SEO titles, tags, descriptions."""

from __future__ import annotations

from typing import Any

from mindarchive.pipeline.step_base import LLMStep, StepContext, StepOutput
from mindarchive.providers.base import LLMResponse


class UploadBlueprint(LLMStep):
    """Generates upload metadata: titles, descriptions, tags, hashtags."""

    def __init__(self, llm: Any, prompt_manager: Any) -> None:
        super().__init__(step_number=13, llm=llm, prompt_manager=prompt_manager)

    def validate_inputs(self, ctx: StepContext) -> list[str]:
        errors = []
        if 3 not in ctx.artifacts:
            errors.append("Step 3 (Hook Generator) output required")
        if 8 not in ctx.artifacts:
            errors.append("Step 8 (Script Edit Loop) output required")
        return errors

    def _build_prompt_variables(self, ctx: StepContext) -> dict[str, Any]:
        return {
            "hooks": ctx.artifacts.get(3, ""),
            "script": ctx.artifacts.get(8, ""),
        }

    def _process_response(self, response: LLMResponse, ctx: StepContext) -> StepOutput:
        return StepOutput(
            step_number=self.step_number,
            step_name=self.step_name,
            status="complete",
            artifact_name="upload_blueprint.md",
            content=response.text,
            summary="Upload metadata generated: titles, tags, descriptions, hashtags",
        )
