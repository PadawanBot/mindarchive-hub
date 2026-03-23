"""Shared production constants — platform physics, not channel-specific."""

from __future__ import annotations

# YouTube platform constants
OUTPUT_RESOLUTION: tuple[int, int] = (1920, 1080)
SHORTS_RESOLUTION: tuple[int, int] = (1080, 1920)
THUMBNAIL_RESOLUTION: tuple[int, int] = (1280, 720)
THUMBNAIL_JPEG_QUALITY: int = 95
TRANSITION_DURATION_S: float = 0.5

# CRITICAL PRODUCTION RULE (applies to ALL profiles and formats):
# MOTION_GRAPHIC tags are visual supplements ONLY — they NEVER replace narration.
# The voiceover MP3 is the production clock. Word count drives runtime.
# Visuals sync to audio.
MOTION_GRAPHIC_RULE: str = "VISUAL_SUPPLEMENT_ONLY"

# DALL-E constants
DALLE_DEFAULT_SIZE: str = "1792x1024"
DALLE_QUALITY: str = "hd"
DALLE_STYLE: str = "vivid"
DALLE_STYLE_SUFFIX: str = "cinematic, photorealistic, 4K documentary style, no text in frame"

# Ken Burns animation defaults
KEN_BURNS_ZOOM_RANGE: tuple[float, float] = (1.02, 1.08)
KEN_BURNS_PAN_RANGE_PX: tuple[int, int] = (20, 60)
KEN_BURNS_MOTION_TYPES: list[str] = ["slow_zoom_in", "slow_zoom_out", "lateral_pan"]

# Brand intro
BRAND_INTRO_DURATION_S: float = 8.0

# Pipeline step numbers
STEP_TOPIC_MINER = 1
STEP_SCRIPTWRITER = 2
STEP_HOOK_GENERATOR = 3
STEP_VOICE_CRAFTER = 4
STEP_VISUAL_DIRECTION = 5
STEP_BLEND_CURATOR = 6
STEP_BRAND_BUILDER = 7
STEP_SCRIPT_EDIT_LOOP = 8
STEP_TIMING_SYNC = 9
STEP_THUMBNAIL_ARCHITECT = 10
STEP_RETENTION_DESIGNER = 11
STEP_COMMENT_MAGNET = 12
STEP_UPLOAD_BLUEPRINT = 13
STEP_CONSISTENCY_SCHEDULER = 14
STEP_MONETIZATION_MAP = 15

ALL_STEPS: list[int] = list(range(1, 16))

# Step dependency graph for parallel execution
# Key = step number, Value = list of steps that must complete before this one can run
STEP_DEPENDENCIES: dict[int, list[int]] = {
    1: [],
    2: [],           # Can run standalone (topic provided via --topic)
    3: [2],          # Needs script
    4: [],           # Standalone (voice design)
    5: [2],          # Needs script — can run parallel with Step 3
    6: [5],          # Needs scenes.json
    7: [],           # Standalone (brand design)
    8: [2, 3],       # Needs script + hooks
    9: [8],          # Needs final script
    10: [3, 8],      # Needs hooks + final script — parallel with 11, 12
    11: [8, 9],      # Needs final script + timing — parallel with 10, 12
    12: [8],         # Needs final script outro — parallel with 10, 11
    13: [3, 8],      # Needs hooks + final script
    14: [],          # Post-launch, per-channel
    15: [],          # Post-launch, per-channel
}

# Steps that can be permanently skipped per-profile
CONDITIONALLY_SKIPPABLE_STEPS: set[int] = {
    STEP_TOPIC_MINER,    # Skip when --topic provided
    STEP_VOICE_CRAFTER,  # Skip when voice locked in profile
    STEP_BRAND_BUILDER,  # Skip when brand assets locked in profile
}

# Pipeline phases
PHASE_PREPRODUCTION = "pre_production"
PHASE_PRODUCTION = "production"
PHASE_ASSEMBLY = "assembly"
PHASE_DISTRIBUTION = "distribution"
PHASE_STRATEGY = "strategy"

PHASE_STEP_MAP: dict[str, list[int]] = {
    PHASE_PREPRODUCTION: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    PHASE_PRODUCTION: [],   # P1-P5 (not numbered as steps)
    PHASE_ASSEMBLY: [],     # P6-P7
    PHASE_DISTRIBUTION: [], # D1-D5
    PHASE_STRATEGY: [14, 15],
}

# App directories
APP_DIR_NAME: str = ".mindarchive"
PROJECTS_DIR_NAME: str = "MindArchive"
DEFAULT_DB_NAME: str = "mindarchive.db"
CREDENTIALS_FILE: str = "credentials.enc"
CONFIG_FILE: str = "config.toml"
