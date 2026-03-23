"""Step 3: Hook Generator — creates viral hooks for cold opens, thumbnails, descriptions."""

from __future__ import annotations

from typing import Any

from mindarchive.pipeline.step_base import LLMStep, StepContext, StepOutput
from mindarchive.providers.base import LLMResponse


class HookGenerator(LLMStep):
    """Generates 10 viral hooks ranked by emotional intensity."""

    def __init__(self, llm: Any, prompt_manager: Any) -> None:
        super().__init__(step_number=3, llm=llm, prompt_manager=prompt_manager)

    def validate_inputs(self, ctx: StepContext) -> list[str]:
        if 2 not in ctx.artifacts:
            return ["Step 2 (Scriptwriter) output required"]
        return []

    def _build_prompt_variables(self, ctx: StepContext) -> dict[str, Any]:
        return {"script": ctx.artifacts.get(2, "")}

    def _process_response(self, response: LLMResponse, ctx: StepContext) -> StepOutput:
        return StepOutput(
            step_number=self.step_number,
            step_name=self.step_name,
            status="complete",
            artifact_name="hooks.md",
            content=response.text,
            summary="Generated 10 viral hooks ranked by intensity",
        )
