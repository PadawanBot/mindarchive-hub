"""Built-in format presets and preset management."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

try:
    import tomli
except ImportError:
    import tomllib as tomli  # type: ignore[no-redef]

import tomli_w


@dataclass
class FormatPresetData:
    """In-memory representation of a format preset."""

    slug: str
    name: str
    description: str = ""
    builtin: bool = False

    # Duration & pacing
    target_duration_min: int = 9
    duration_range_min: int = 8
    duration_range_max: int = 10
    base_wpm: int = 140

    # Word count
    target_words: int = 1260
    word_range_min: int = 1120
    word_range_max: int = 1400

    # Structure
    structure: str = "3-act structure like a Netflix episode"
    cold_open_max_seconds: int = 7
    retention_checkpoints: int = 5

    # Visual parameters
    visual_density: str = "medium"
    runway_max_scenes: int = 4
    stock_ratio: float | None = None

    # Tone & style
    tone_instruction: str = ""
    style_model: str = ""
    visual_style: str = "cinematic, documentary, stylized realism"


# ─── Built-in presets (Section 5.2 of architecture) ───

DOCUMENTARY = FormatPresetData(
    slug="documentary",
    name="Documentary",
    description="8-10 min deep-dive documentary, Netflix-style 3-act structure",
    builtin=True,
    target_duration_min=9,
    duration_range_min=8,
    duration_range_max=10,
    base_wpm=140,
    target_words=1260,
    word_range_min=1120,
    word_range_max=1400,
    structure="3-act structure like a Netflix episode",
    cold_open_max_seconds=7,
    retention_checkpoints=5,
    visual_density="medium",
    runway_max_scenes=4,
    tone_instruction="Authoritative yet accessible. Mix of Attenborough gravitas with Ira Glass intimacy.",
    style_model="Attenborough x Ira Glass x Johnny Harris",
    visual_style="cinematic, documentary, stylized realism",
)

EXPLAINER = FormatPresetData(
    slug="explainer",
    name="Explainer",
    description="5-7 min educational explainer, concept-driven with visual aids",
    builtin=True,
    target_duration_min=6,
    duration_range_min=5,
    duration_range_max=7,
    base_wpm=150,
    target_words=900,
    word_range_min=750,
    word_range_max=1050,
    structure="Problem → Mechanism → Solution → Takeaway",
    cold_open_max_seconds=5,
    retention_checkpoints=4,
    visual_density="high",
    runway_max_scenes=2,
    tone_instruction="Curious and clear. Teacher energy without condescension.",
    style_model="Kurzgesagt x Veritasium",
    visual_style="clean, infographic-inspired, bold colours",
)

LISTICLE = FormatPresetData(
    slug="listicle",
    name="Listicle",
    description="10-15 min ranked list format, high retention through structure",
    builtin=True,
    target_duration_min=12,
    duration_range_min=10,
    duration_range_max=15,
    base_wpm=145,
    target_words=1740,
    word_range_min=1450,
    word_range_max=2175,
    structure="Countdown or ranked list (10 → 1) with mini-arcs per item",
    cold_open_max_seconds=7,
    retention_checkpoints=6,
    visual_density="high",
    runway_max_scenes=5,
    tone_instruction="Energetic, slightly provocative. Each item is a mini-revelation.",
    style_model="WatchMojo x Thoughty2",
    visual_style="dynamic, bold transitions, number cards",
)

STORY = FormatPresetData(
    slug="story",
    name="Story",
    description="12-18 min narrative storytelling, true crime / history style",
    builtin=True,
    target_duration_min=15,
    duration_range_min=12,
    duration_range_max=18,
    base_wpm=135,
    target_words=2025,
    word_range_min=1620,
    word_range_max=2430,
    structure="5-act dramatic structure: Setup, Rising Action, Climax, Falling Action, Resolution",
    cold_open_max_seconds=10,
    retention_checkpoints=7,
    visual_density="medium",
    runway_max_scenes=5,
    tone_instruction="Intimate, suspenseful. Pull the viewer into the story like a campfire tale.",
    style_model="JCS Criminal Psychology x Nexpo",
    visual_style="moody, cinematic, noir-influenced",
)

SHORT = FormatPresetData(
    slug="short",
    name="Short",
    description="Under 60s vertical short, punchy single-idea format",
    builtin=True,
    target_duration_min=1,
    duration_range_min=0,
    duration_range_max=1,
    base_wpm=160,
    target_words=140,
    word_range_min=100,
    word_range_max=160,
    structure="Hook → One idea → Punchline/CTA",
    cold_open_max_seconds=2,
    retention_checkpoints=2,
    visual_density="high",
    runway_max_scenes=1,
    tone_instruction="Punchy, immediate. No warmup. Every word earns its spot.",
    style_model="Shorts viral format",
    visual_style="vertical, bold text overlays, fast cuts",
)

# Registry of all built-in presets
BUILTIN_PRESETS: dict[str, FormatPresetData] = {
    p.slug: p for p in [DOCUMENTARY, EXPLAINER, LISTICLE, STORY, SHORT]
}


def preset_to_dict(preset: FormatPresetData) -> dict[str, Any]:
    """Convert preset to a dictionary for TOML serialization."""
    from dataclasses import asdict
    return asdict(preset)


def load_custom_preset(path: Path) -> FormatPresetData:
    """Load a custom format preset from a TOML file."""
    with open(path, "rb") as f:
        data = tomli.load(f)
    preset_data = data.get("format", data)
    return FormatPresetData(**preset_data)


def save_custom_preset(preset: FormatPresetData, path: Path) -> None:
    """Save a custom format preset to a TOML file."""
    data = {"format": preset_to_dict(preset)}
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as f:
        tomli_w.dump(data, f)


def get_preset(slug: str, custom_dir: Path | None = None) -> FormatPresetData | None:
    """Get a preset by slug — checks built-in first, then custom directory."""
    if slug in BUILTIN_PRESETS:
        return BUILTIN_PRESETS[slug]
    if custom_dir and (custom_dir / f"{slug}.toml").exists():
        return load_custom_preset(custom_dir / f"{slug}.toml")
    return None


def list_presets(custom_dir: Path | None = None) -> list[FormatPresetData]:
    """List all available presets (built-in + custom)."""
    presets = list(BUILTIN_PRESETS.values())
    if custom_dir and custom_dir.exists():
        for toml_file in sorted(custom_dir.glob("*.toml")):
            try:
                preset = load_custom_preset(toml_file)
                if preset.slug not in BUILTIN_PRESETS:
                    presets.append(preset)
            except Exception:
                continue
    return presets
