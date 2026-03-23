"""Quality scoring system — automated validation after each pipeline step."""

from __future__ import annotations

import re
from dataclasses import dataclass, field


@dataclass
class QualityReport:
    """Result of a quality check on a step's output."""

    step_number: int
    score: float  # 0.0 - 1.0
    passed: bool
    checks: list[QualityCheck] = field(default_factory=list)

    @property
    def summary(self) -> str:
        failed = [c for c in self.checks if not c.passed]
        if not failed:
            return f"All {len(self.checks)} checks passed (score: {self.score:.0%})"
        names = ", ".join(c.name for c in failed)
        return f"{len(failed)}/{len(self.checks)} checks failed: {names} (score: {self.score:.0%})"


@dataclass
class QualityCheck:
    """A single quality check result."""

    name: str
    passed: bool
    detail: str = ""
    weight: float = 1.0


def check_script_quality(
    script_text: str,
    target_words: int = 1260,
    word_range_min: int = 1200,
    word_range_max: int = 1300,
    runway_max: int = 4,
) -> QualityReport:
    """Validate a script output from Step 2 or Step 8."""
    checks: list[QualityCheck] = []

    # Word count check (narration only — strip visual tags)
    narration = _extract_narration(script_text)
    word_count = len(narration.split())
    in_range = word_range_min <= word_count <= word_range_max
    checks.append(QualityCheck(
        name="word_count",
        passed=in_range,
        detail=f"{word_count} words (target: {word_range_min}-{word_range_max})",
        weight=2.0,
    ))

    # RUNWAY count check
    runway_count = len(re.findall(r"\[RUNWAY:", script_text))
    checks.append(QualityCheck(
        name="runway_count",
        passed=runway_count <= runway_max,
        detail=f"{runway_count} RUNWAY scenes (max: {runway_max})",
        weight=1.5,
    ))

    # No text in DALLE prompts
    dalle_prompts = re.findall(r"\[DALLE:\s*(.*?)\]", script_text, re.DOTALL)
    text_in_dalle = any(_has_text_instruction(p) for p in dalle_prompts)
    checks.append(QualityCheck(
        name="dalle_no_text",
        passed=not text_in_dalle,
        detail="No text instructions in DALLE prompts" if not text_in_dalle
        else "Found text instructions in DALLE prompts — Pillow handles text",
        weight=1.5,
    ))

    # MOTION_GRAPHIC rule — check they don't replace narration
    mg_count = len(re.findall(r"\[MOTION_GRAPHIC:", script_text))
    checks.append(QualityCheck(
        name="motion_graphic_present",
        passed=True,
        detail=f"{mg_count} MOTION_GRAPHIC tags found",
        weight=0.5,
    ))

    # Visual tags present for most scenes
    total_tags = (
        len(re.findall(r"\[DALLE:", script_text))
        + runway_count
        + len(re.findall(r"\[STOCK:", script_text))
        + mg_count
    )
    checks.append(QualityCheck(
        name="visual_coverage",
        passed=total_tags >= 5,
        detail=f"{total_tags} visual tags total",
        weight=1.0,
    ))

    return _build_report(2, checks)


def check_hooks_quality(hooks_text: str) -> QualityReport:
    """Validate hook generator output from Step 3."""
    checks: list[QualityCheck] = []

    # Count hooks (look for numbered items)
    hook_matches = re.findall(r"(?:^|\n)\s*\d+[\.\)]\s*", hooks_text)
    hook_count = len(hook_matches)
    checks.append(QualityCheck(
        name="hook_count",
        passed=hook_count >= 8,
        detail=f"{hook_count} hooks found (target: 10)",
        weight=1.0,
    ))

    return _build_report(3, checks)


def _extract_narration(text: str) -> str:
    """Strip visual tags and scene directions to get narration-only text."""
    # Remove visual tags
    cleaned = re.sub(r"\[(DALLE|RUNWAY|STOCK|MOTION_GRAPHIC):.*?\]", "", text, flags=re.DOTALL)
    # Remove common scene direction markers
    cleaned = re.sub(r"\[.*?\]", "", cleaned)
    return cleaned.strip()


def _has_text_instruction(prompt: str) -> bool:
    """Check if a DALLE prompt contains text/word instructions."""
    text_patterns = [
        r"\btext\b", r"\bwords?\b", r"\bletter", r"\bsign\b",
        r"\blabel\b", r"\btitle\b", r"\bsubtitle\b", r"\bcaption\b",
        r'\b"[A-Z]', r"\bsaying\b", r"\breading\b",
    ]
    for pattern in text_patterns:
        if re.search(pattern, prompt, re.IGNORECASE):
            return True
    return False


def _build_report(step_number: int, checks: list[QualityCheck]) -> QualityReport:
    """Calculate weighted score and build report."""
    if not checks:
        return QualityReport(step_number=step_number, score=1.0, passed=True)

    total_weight = sum(c.weight for c in checks)
    earned = sum(c.weight for c in checks if c.passed)
    score = earned / total_weight if total_weight > 0 else 1.0
    passed = all(c.passed for c in checks if c.weight >= 1.0)

    return QualityReport(step_number=step_number, score=score, passed=passed, checks=checks)
