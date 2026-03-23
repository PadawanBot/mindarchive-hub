"""Step 2: Scriptwriter — generates the initial narration script with visual tags."""

from __future__ import annotations

import re
from typing import Any

from mindarchive.pipeline.step_base import LLMStep, StepContext, StepOutput
from mindarchive.providers.base import LLMResponse


class Scriptwriter(LLMStep):
    """Generates the initial video script with embedded visual direction tags."""

    def __init__(self, llm: Any, prompt_manager: Any) -> None:
        super().__init__(step_number=2, llm=llm, prompt_manager=prompt_manager)

    def _process_response(self, response: LLMResponse, ctx: StepContext) -> StepOutput:
        script = response.text
        word_count = _count_narration_words(script)
        runway_count = len(re.findall(r"\[RUNWAY:", script))
        dalle_count = len(re.findall(r"\[DALLE:", script))
        stock_count = len(re.findall(r"\[STOCK:", script))
        mg_count = len(re.findall(r"\[MOTION_GRAPHIC:", script))

        summary = (
            f"{word_count} words | "
            f"DALLE: {dalle_count}, STOCK: {stock_count}, "
            f"RUNWAY: {runway_count}, MG: {mg_count}"
        )

        return StepOutput(
            step_number=self.step_number,
            step_name=self.step_name,
            status="complete",
            artifact_name="script_draft.md",
            content=script,
            summary=summary,
            structured_data={
                "word_count": word_count,
                "runway_count": runway_count,
                "dalle_count": dalle_count,
                "stock_count": stock_count,
                "motion_graphic_count": mg_count,
            },
        )

    def validate_output(self, output: StepOutput, ctx: StepContext) -> dict[str, Any] | None:
        """Check script against format preset constraints."""
        if not output.content:
            return {"score": 0.0, "notes": "Empty script"}

        from mindarchive.services.quality_checker import check_script_quality

        report = check_script_quality(
            output.content,
            target_words=ctx.format_preset.get("target_words", 1260),
            word_range_min=ctx.format_preset.get("word_range_min", 1120),
            word_range_max=ctx.format_preset.get("word_range_max", 1400),
            runway_max=ctx.format_preset.get("runway_max_scenes", 4),
        )
        return {"score": report.score, "notes": report.summary}


def _count_narration_words(script: str) -> int:
    """Count words in narration only (strip visual tags)."""
    cleaned = re.sub(r"\[(DALLE|RUNWAY|STOCK|MOTION_GRAPHIC):.*?\]", "", script, flags=re.DOTALL)
    cleaned = re.sub(r"\[.*?\]", "", cleaned)
    return len(cleaned.split())
