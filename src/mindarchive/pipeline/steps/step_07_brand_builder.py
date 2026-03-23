"""Step 7: Brand Builder — creates channel brand identity."""

from __future__ import annotations

from typing import Any

from mindarchive.pipeline.step_base import LLMStep, StepContext, StepOutput
from mindarchive.providers.base import LLMResponse


class BrandBuilder(LLMStep):
    """Designs brand identity: name, palette, intro/outro, typography."""

    def __init__(self, llm: Any, prompt_manager: Any) -> None:
        super().__init__(step_number=7, llm=llm, prompt_manager=prompt_manager)

    def should_skip(self, ctx: StepContext) -> str | None:
        if ctx.profile.get("brand_locked"):
            return "Brand already locked in profile"
        return None

    def _process_response(self, response: LLMResponse, ctx: StepContext) -> StepOutput:
        return StepOutput(
            step_number=self.step_number,
            step_name=self.step_name,
            status="complete",
            artifact_name="brand_identity.md",
            content=response.text,
            summary="Brand identity designed — review and lock in profile",
        )
