"""Step 8: Script Edit Loop — iterative refinement of the script."""

from __future__ import annotations

import re
from typing import Any

from mindarchive.pipeline.step_base import LLMStep, StepContext, StepOutput
from mindarchive.providers.base import LLMResponse


class ScriptEditLoop(LLMStep):
    """Runs iterative edit/review cycles on the script until quality converges."""

    def __init__(self, llm: Any, prompt_manager: Any, max_iterations: int = 3) -> None:
        super().__init__(step_number=8, llm=llm, prompt_manager=prompt_manager)
        self._max_iterations = max_iterations

    def validate_inputs(self, ctx: StepContext) -> list[str]:
        errors = []
        if 2 not in ctx.artifacts:
            errors.append("Step 2 (Scriptwriter) output required")
        if 3 not in ctx.artifacts:
            errors.append("Step 3 (Hook Generator) output required")
        return errors

    def _build_prompt_variables(self, ctx: StepContext) -> dict[str, Any]:
        return {
            "script": ctx.artifacts.get(2, ""),
            "hooks": ctx.artifacts.get(3, ""),
        }

    async def _run(self, ctx: StepContext) -> StepOutput:
        """Override _run to use the edit loop pattern."""
        extra = self._build_prompt_variables(ctx)
        variables = self._prompts.build_variables(
            topic=ctx.topic,
            profile_data=ctx.profile,
            format_data=ctx.format_preset,
            extra={**ctx.extra_vars, **extra},
        )

        system_prompt = self._prompts.get_system_prompt(ctx.profile.get("slug"))
        user_prompt = self._prompts.get_prompt(
            self.step_number, variables, ctx.profile.get("slug")
        )

        review_prompt = (
            "Review this script for:\n"
            "1. Word count compliance ({word_range_min}-{word_range_max} words narration only)\n"
            "2. RUNWAY scene count (max {runway_max_scenes})\n"
            "3. No text instructions in DALLE prompts\n"
            "4. MOTION_GRAPHIC tags are supplements only, not narration replacements\n"
            "5. Flow, pacing, and emotional arc\n\n"
            "If the script passes all checks, respond with 'APPROVED — ready for production.'\n"
            "If changes are needed, provide the corrected version."
        ).format(**variables)

        final_response, history = await self._llm.generate_with_edit_loop(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            review_prompt=review_prompt,
            model=ctx.model,
            max_iterations=self._max_iterations,
        )

        word_count = _count_narration_words(final_response.text)

        return StepOutput(
            step_number=self.step_number,
            step_name=self.step_name,
            status="complete",
            artifact_name="script_final.md",
            content=final_response.text,
            summary=f"Script polished in {len(history)} iterations, {word_count} words final",
            llm_response=final_response,
            structured_data={"iterations": len(history), "word_count": word_count},
        )

    def _process_response(self, response: LLMResponse, ctx: StepContext) -> StepOutput:
        # Not used — _run is overridden
        return StepOutput(
            step_number=self.step_number,
            step_name=self.step_name,
            status="complete",
            content=response.text,
        )

    def validate_output(self, output: StepOutput, ctx: StepContext) -> dict[str, Any] | None:
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
    cleaned = re.sub(r"\[(DALLE|RUNWAY|STOCK|MOTION_GRAPHIC):.*?\]", "", script, flags=re.DOTALL)
    cleaned = re.sub(r"\[.*?\]", "", cleaned)
    return len(cleaned.split())
