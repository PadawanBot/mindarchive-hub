"""Step 15: Monetization Expansion Map — passive income strategies."""

from __future__ import annotations

from typing import Any

from mindarchive.pipeline.step_base import LLMStep, StepContext, StepOutput
from mindarchive.providers.base import LLMResponse


class MonetizationMap(LLMStep):
    """Generates monetization strategies ranked by profitability."""

    def __init__(self, llm: Any, prompt_manager: Any) -> None:
        super().__init__(step_number=15, llm=llm, prompt_manager=prompt_manager)

    def _process_response(self, response: LLMResponse, ctx: StepContext) -> StepOutput:
        return StepOutput(
            step_number=self.step_number,
            step_name=self.step_name,
            status="complete",
            artifact_name="monetization_map.md",
            content=response.text,
            summary="Monetization strategies mapped and ranked",
        )
