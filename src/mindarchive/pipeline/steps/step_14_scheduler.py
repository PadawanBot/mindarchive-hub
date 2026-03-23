"""Step 14: Consistency Scheduler — builds the 12-week content calendar."""

from __future__ import annotations

from typing import Any

from mindarchive.pipeline.step_base import LLMStep, StepContext, StepOutput
from mindarchive.providers.base import LLMResponse


class ConsistencyScheduler(LLMStep):
    """Generates a 12-week content calendar with format alternation."""

    def __init__(self, llm: Any, prompt_manager: Any) -> None:
        super().__init__(step_number=14, llm=llm, prompt_manager=prompt_manager)

    def _build_prompt_variables(self, ctx: StepContext) -> dict[str, Any]:
        return {
            "available_topics_count": ctx.extra_vars.get("available_topics_count", 0),
            "available_formats": ctx.extra_vars.get(
                "available_formats", "documentary, explainer, listicle, story, short"
            ),
        }

    def _process_response(self, response: LLMResponse, ctx: StepContext) -> StepOutput:
        return StepOutput(
            step_number=self.step_number,
            step_name=self.step_name,
            status="complete",
            artifact_name="content_calendar.md",
            content=response.text,
            summary="12-week content calendar generated",
        )
