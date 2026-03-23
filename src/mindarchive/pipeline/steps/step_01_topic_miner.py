"""Step 1: Topic Miner — finds trending topics for the channel niche."""

from __future__ import annotations

import json
import re
from typing import Any

from mindarchive.pipeline.step_base import LLMStep, StepContext, StepOutput
from mindarchive.providers.base import LLMResponse


class TopicMiner(LLMStep):
    """Mines trending topics with viral scoring."""

    def __init__(self, llm: Any, prompt_manager: Any) -> None:
        super().__init__(step_number=1, llm=llm, prompt_manager=prompt_manager)

    def should_skip(self, ctx: StepContext) -> str | None:
        # Skip when --topic is provided directly (topic already chosen)
        if ctx.topic and ctx.extra_vars.get("topic_provided_directly"):
            return "Topic provided via --topic, skipping Topic Miner"
        return None

    def _build_prompt_variables(self, ctx: StepContext) -> dict[str, Any]:
        return {
            "available_topics_count": ctx.extra_vars.get("available_topics_count", 0),
        }

    def _process_response(self, response: LLMResponse, ctx: StepContext) -> StepOutput:
        # Try to extract JSON from the response
        structured = _extract_json(response.text)

        return StepOutput(
            step_number=self.step_number,
            step_name=self.step_name,
            status="complete",
            artifact_name="topics.json",
            content=response.text,
            structured_data=structured,
            summary=f"Generated topic bank with {len(structured.get('topics', [])) if structured else '?'} topics",
        )


def _extract_json(text: str) -> dict[str, Any] | None:
    """Extract JSON block from LLM response text."""
    # Look for ```json ... ``` blocks
    match = re.search(r"```json\s*([\s\S]*?)```", text)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass

    # Try parsing the entire text
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None
