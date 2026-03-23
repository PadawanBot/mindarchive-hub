"""Prompt template system with versioning and profile overrides."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any


# ─── Step name registry ───

STEP_NAMES: dict[int, str] = {
    1: "Topic Miner",
    2: "Scriptwriter",
    3: "Hook Generator",
    4: "Voice Crafter",
    5: "Visual Direction Mapper",
    6: "Stock + AI Blend Curator",
    7: "Brand Builder",
    8: "Script Edit Loop",
    9: "Scene-to-Voice Timing Sync",
    10: "Thumbnail Architect",
    11: "Retention Structure Designer",
    12: "Comment Magnet Script Finisher",
    13: "Upload Optimization Blueprint",
    14: "Consistency Scheduler",
    15: "Monetization Expansion Map",
}


class PromptManager:
    """Manages prompt templates: generic base + profile overrides + format injection."""

    def __init__(self, prompts_dir: Path) -> None:
        self._prompts_dir = prompts_dir

    def get_prompt(
        self,
        step_number: int,
        variables: dict[str, Any],
        profile_slug: str | None = None,
    ) -> str:
        """Get the fully rendered prompt for a step.

        Priority:
        1. Profile override (profiles/<slug>/prompts/overrides/step_XX.md)
        2. Generic prompt (pipeline/prompts/generic/step_XX.md)
        3. Inline fallback
        """
        prompt_text: str | None = None

        # Try profile override first
        if profile_slug:
            override_dir = self._prompts_dir.parent.parent / "profiles" / profile_slug / "prompts" / "overrides"
            override_file = override_dir / f"step_{step_number:02d}.md"
            if override_file.exists():
                prompt_text = override_file.read_text()

        # Fall back to generic prompt
        if prompt_text is None:
            generic_file = self._prompts_dir / "generic" / f"step_{step_number:02d}.md"
            if generic_file.exists():
                prompt_text = generic_file.read_text()

        # Final fallback: return a placeholder
        if prompt_text is None:
            step_name = STEP_NAMES.get(step_number, f"Step {step_number}")
            prompt_text = f"Execute Step {step_number}: {step_name} for {{topic}}."

        # Substitute variables
        return _render_template(prompt_text, variables)

    def get_system_prompt(self, profile_slug: str | None = None) -> str:
        """Get the system prompt (SKILL.md or generic system prompt)."""
        # Try profile-specific SKILL.md
        if profile_slug:
            skill_path = (
                self._prompts_dir.parent.parent
                / "profiles"
                / profile_slug
                / "prompts"
                / "skill_system.md"
            )
            if skill_path.exists():
                return skill_path.read_text()

        # Fall back to generic system prompt
        generic_system = self._prompts_dir / "generic_system.md"
        if generic_system.exists():
            return generic_system.read_text()

        return "You are an expert YouTube video production assistant."

    def build_variables(
        self,
        topic: str,
        profile_data: dict[str, Any] | None = None,
        format_data: dict[str, Any] | None = None,
        extra: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Build the full variable dictionary for prompt rendering."""
        variables: dict[str, Any] = {"topic": topic}

        # Inject profile values
        if profile_data:
            variables.update({
                "niche": profile_data.get("niche", ""),
                "tone": profile_data.get("tone_instruction", ""),
                "tone_instruction": profile_data.get("tone_instruction", ""),
                "style_model": profile_data.get("style_model", ""),
                "visual_style": profile_data.get("visual_style", ""),
                "published_count": profile_data.get("published_count", 0),
                "avg_views": profile_data.get("avg_views", 0),
                "upload_frequency": profile_data.get("upload_frequency", 2),
                "runway_max_scenes": profile_data.get("runway_max_scenes", 4),
            })

        # Inject format values
        if format_data:
            variables.update({
                "format_name": format_data.get("name", "documentary"),
                "target_duration_min": format_data.get("target_duration_min", 9),
                "base_wpm": format_data.get("base_wpm", 140),
                "target_words": format_data.get("target_words", 1260),
                "word_range_min": format_data.get("word_range_min", 1120),
                "word_range_max": format_data.get("word_range_max", 1400),
                "structure": format_data.get("structure", "3-act structure"),
                "cold_open_max_seconds": format_data.get("cold_open_max_seconds", 7),
                "retention_checkpoints": format_data.get("retention_checkpoints", 5),
                "visual_density": format_data.get("visual_density", "medium"),
            })

        # Extra overrides
        if extra:
            variables.update(extra)

        return variables


def _render_template(template: str, variables: dict[str, Any]) -> str:
    """Render {placeholder} variables in a prompt template.

    Uses a safe approach that only replaces known variables, leaving
    unknown {placeholders} intact (avoids KeyError on JSON/code blocks).
    """
    def replacer(match: re.Match) -> str:
        key = match.group(1)
        if key in variables:
            return str(variables[key])
        return match.group(0)  # Leave unknown placeholders as-is

    return re.sub(r"\{(\w+)\}", replacer, template)
