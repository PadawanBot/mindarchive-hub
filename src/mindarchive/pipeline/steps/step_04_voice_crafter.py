"""Step 4: Voice Crafter — designs the AI voice personality and ElevenLabs settings."""

from __future__ import annotations

from typing import Any

from mindarchive.pipeline.step_base import LLMStep, StepContext, StepOutput
from mindarchive.providers.base import LLMResponse


class VoiceCrafter(LLMStep):
    """Designs voice identity and ElevenLabs configuration."""

    def __init__(self, llm: Any, prompt_manager: Any) -> None:
        super().__init__(step_number=4, llm=llm, prompt_manager=prompt_manager)

    def should_skip(self, ctx: StepContext) -> str | None:
        if ctx.profile.get("voice_locked"):
            return f"Voice already locked: {ctx.profile.get('voice_name', 'unnamed')}"
        return None

    def _build_prompt_variables(self, ctx: StepContext) -> dict[str, Any]:
        return {
            "tone": ctx.profile.get("tone_instruction", ""),
        }

    def _process_response(self, response: LLMResponse, ctx: StepContext) -> StepOutput:
        return StepOutput(
            step_number=self.step_number,
            step_name=self.step_name,
            status="complete",
            artifact_name="voice_design.md",
            content=response.text,
            summary="Voice identity designed — review and lock in profile",
        )
