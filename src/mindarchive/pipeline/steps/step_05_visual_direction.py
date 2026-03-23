"""Step 5: Visual Direction Mapper — generates scene-by-scene visual prompts."""

from __future__ import annotations

import json
import re
from typing import Any

from mindarchive.pipeline.step_base import LLMStep, StepContext, StepOutput
from mindarchive.providers.base import LLMResponse


class VisualDirectionMapper(LLMStep):
    """Maps each script scene to detailed visual prompts (scenes.json)."""

    def __init__(self, llm: Any, prompt_manager: Any) -> None:
        super().__init__(step_number=5, llm=llm, prompt_manager=prompt_manager)

    def validate_inputs(self, ctx: StepContext) -> list[str]:
        if 2 not in ctx.artifacts:
            return ["Step 2 (Scriptwriter) output required"]
        return []

    def _build_prompt_variables(self, ctx: StepContext) -> dict[str, Any]:
        return {"script": ctx.artifacts.get(2, "")}

    def _process_response(self, response: LLMResponse, ctx: StepContext) -> StepOutput:
        # Try to extract scenes.json
        structured = _extract_scenes_json(response.text)
        scene_count = len(structured.get("scenes", [])) if structured else 0

        return StepOutput(
            step_number=self.step_number,
            step_name=self.step_name,
            status="complete",
            artifact_name="scenes.json",
            content=response.text,
            structured_data=structured,
            summary=f"Mapped {scene_count} visual scenes",
        )


def _extract_scenes_json(text: str) -> dict[str, Any] | None:
    """Extract scenes JSON from LLM response."""
    match = re.search(r"```json\s*([\s\S]*?)```", text)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None
