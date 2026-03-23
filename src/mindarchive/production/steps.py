"""Production steps P1-P7 — media generation and assembly.

These run after the 15 pre-production steps complete.
Each step is a standalone async function that takes a ProductionContext.

Pipeline:
  P1: Voiceover Generation (ElevenLabs TTS)
  P2: Scene Image Generation (DALL-E 3)
  P3: Stock Footage Download (Pexels)
  P4: Hero Motion Generation (Runway Gen-3)
  P5: Ken Burns Animation (Pillow → FFmpeg)
  P6: Motion Graphics & Text Overlays (Pillow)
  P7: Final Assembly (FFmpeg concat + audio mix)
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class ProductionContext:
    """Everything the production pipeline needs."""

    project_slug: str
    output_dir: Path

    # Pre-production artifacts
    final_script: str = ""
    scenes_json: dict[str, Any] | None = None
    timing_table: str = ""
    blend_plan: str = ""
    thumbnail_concepts: str = ""

    # Profile settings
    voice_settings: dict[str, Any] = field(default_factory=dict)
    dalle_style_suffix: str = "cinematic, photorealistic, 4K documentary style, no text in frame"
    runway_max_scenes: int = 4

    # Brand assets
    brand_intro_path: Path | None = None

    # Generated assets (populated by each step)
    voiceover_path: Path | None = None
    voiceover_duration: float = 0.0
    scene_images: list[dict[str, Any]] = field(default_factory=list)
    stock_clips: list[dict[str, Any]] = field(default_factory=list)
    runway_clips: list[dict[str, Any]] = field(default_factory=list)
    ken_burns_clips: list[dict[str, Any]] = field(default_factory=list)
    motion_graphics: list[dict[str, Any]] = field(default_factory=list)
    scene_clips: list[dict[str, Any]] = field(default_factory=list)  # All clips in timeline order
    visual_track_path: Path | None = None
    final_video_path: Path | None = None
    thumbnail_path: Path | None = None


@dataclass
class ProductionStepResult:
    """Result of a production step."""

    step_id: str
    status: str  # complete, error
    message: str = ""
    assets: list[dict[str, Any]] = field(default_factory=list)
    cost_usd: float = 0.0
    error: str | None = None


# ═══════════════════════════════════════════════════════════
# P1: Voiceover Generation
# ═══════════════════════════════════════════════════════════


async def p1_generate_voiceover(
    ctx: ProductionContext,
    voice_provider: Any,  # ElevenLabsVoice
) -> ProductionStepResult:
    """P1: Generate voiceover MP3 from the final polished script.

    The voiceover MP3 is the production clock — everything syncs to it.
    """
    from mindarchive.providers.base import VoiceSettings

    narration = _extract_narration(ctx.final_script)
    if not narration:
        return ProductionStepResult(
            step_id="P1",
            status="error",
            error="No narration text found in script",
        )

    voice_cfg = ctx.voice_settings
    settings = VoiceSettings(
        voice_id=voice_cfg.get("voice_id", ""),
        voice_name=voice_cfg.get("voice_name", ""),
        model=voice_cfg.get("voice_model", "eleven_v3"),
        stability=voice_cfg.get("voice_stability", 0.5),
        similarity_boost=voice_cfg.get("voice_similarity", 0.85),
        style=voice_cfg.get("voice_style", 0.3),
        base_wpm=voice_cfg.get("voice_base_wpm", 140),
    )

    output_path = ctx.output_dir / "audio" / "voiceover.mp3"
    await voice_provider.generate_voiceover(narration, settings, output_path)

    cost = await voice_provider.estimate_cost(narration)

    from mindarchive.production.ffmpeg_assembler import get_duration

    ctx.voiceover_path = output_path
    ctx.voiceover_duration = get_duration(output_path)

    return ProductionStepResult(
        step_id="P1",
        status="complete",
        message=f"Voiceover: {len(narration)} chars, {ctx.voiceover_duration:.1f}s",
        assets=[{"type": "voiceover", "path": str(output_path)}],
        cost_usd=cost,
    )


# ═══════════════════════════════════════════════════════════
# P2: Scene Image Generation
# ═══════════════════════════════════════════════════════════


async def p2_generate_images(
    ctx: ProductionContext,
    image_provider: Any,  # DallEImageProvider
) -> ProductionStepResult:
    """P2: Generate DALL-E images for all [DALLE:] tagged scenes."""
    from mindarchive.providers.base import ImageSettings

    dalle_scenes = _extract_tagged_scenes(ctx.final_script, "DALLE")
    if not dalle_scenes:
        return ProductionStepResult(
            step_id="P2",
            status="complete",
            message="No DALLE scenes to generate",
        )

    settings = ImageSettings(style_suffix=ctx.dalle_style_suffix)
    output_dir = ctx.output_dir / "visuals" / "dalle"

    results = await image_provider.generate_scene_images(dalle_scenes, settings, output_dir)

    generated = [r for r in results if r["status"] == "generated"]
    cost = await image_provider.estimate_cost(len(generated))

    ctx.scene_images = results

    return ProductionStepResult(
        step_id="P2",
        status="complete",
        message=f"Generated {len(generated)}/{len(dalle_scenes)} DALL-E images",
        assets=[{"type": "dalle_image", **r} for r in generated],
        cost_usd=cost,
    )


# ═══════════════════════════════════════════════════════════
# P3: Stock Footage Download
# ═══════════════════════════════════════════════════════════


async def p3_download_stock(
    ctx: ProductionContext,
    stock_provider: Any,  # PexelsStockProvider
) -> ProductionStepResult:
    """P3: Download Pexels stock footage for all [STOCK:] tagged scenes."""
    stock_scenes = _extract_tagged_scenes(ctx.final_script, "STOCK")
    if not stock_scenes:
        return ProductionStepResult(
            step_id="P3",
            status="complete",
            message="No STOCK scenes to download",
        )

    output_dir = ctx.output_dir / "visuals" / "stock"
    all_clips: list[dict[str, Any]] = []

    for scene in stock_scenes:
        keywords = scene["prompt"].split(",")
        keywords = [k.strip() for k in keywords if k.strip()]
        if not keywords:
            keywords = [scene["prompt"]]

        clips = await stock_provider.search_and_download(keywords, output_dir, max_clips=1)
        for clip in clips:
            clip["scene_id"] = scene["scene_id"]
        all_clips.extend(clips)

    ctx.stock_clips = all_clips

    return ProductionStepResult(
        step_id="P3",
        status="complete",
        message=f"Downloaded {len(all_clips)} stock clips",
        assets=[{"type": "stock_clip", **c} for c in all_clips],
        cost_usd=0.0,
    )


# ═══════════════════════════════════════════════════════════
# P4: Hero Motion Generation (Runway)
# ═══════════════════════════════════════════════════════════


async def p4_generate_runway(
    ctx: ProductionContext,
    video_provider: Any,  # RunwayVideoProvider
) -> ProductionStepResult:
    """P4: Generate Runway Gen-3 video for all [RUNWAY:] tagged scenes."""
    from mindarchive.providers.base import VideoSettings

    runway_scenes = _extract_tagged_scenes(ctx.final_script, "RUNWAY")

    # Enforce max scenes cap
    if len(runway_scenes) > ctx.runway_max_scenes:
        logger.warning(
            "Script has %d RUNWAY scenes but max is %d — truncating",
            len(runway_scenes),
            ctx.runway_max_scenes,
        )
        runway_scenes = runway_scenes[: ctx.runway_max_scenes]

    if not runway_scenes:
        return ProductionStepResult(
            step_id="P4",
            status="complete",
            message="No RUNWAY scenes to generate",
        )

    settings = VideoSettings(duration_seconds=5)
    output_dir = ctx.output_dir / "visuals" / "runway"

    # Build reference image mapping (use DALL-E images if available)
    ref_images: dict[int, Path] = {}
    for img in ctx.scene_images:
        if img.get("status") == "generated" and img.get("path"):
            ref_images[img["scene_id"]] = Path(img["path"])

    results = await video_provider.generate_hero_scenes(
        runway_scenes, settings, output_dir, ref_images
    )

    generated = [r for r in results if r["status"] == "generated"]
    cost = await video_provider.estimate_cost(len(generated))

    ctx.runway_clips = results

    return ProductionStepResult(
        step_id="P4",
        status="complete",
        message=f"Generated {len(generated)}/{len(runway_scenes)} Runway clips",
        assets=[{"type": "runway_clip", **r} for r in generated],
        cost_usd=cost,
    )


# ═══════════════════════════════════════════════════════════
# P5: Ken Burns Animation
# ═══════════════════════════════════════════════════════════


async def p5_ken_burns_animation(
    ctx: ProductionContext,
) -> ProductionStepResult:
    """P5: Apply Ken Burns pan/zoom to DALL-E still images, convert to video clips."""
    from mindarchive.production.compositor import KenBurnsGenerator
    from mindarchive.production.ffmpeg_assembler import FFmpegAssembler

    kb = KenBurnsGenerator()
    assembler = FFmpegAssembler()

    generated_images = [
        img for img in ctx.scene_images if img.get("status") == "generated" and img.get("path")
    ]

    # Skip images that already have Runway clips
    runway_scene_ids = {r.get("scene_id") for r in ctx.runway_clips if r.get("status") == "generated"}
    images_to_animate = [
        img for img in generated_images if img["scene_id"] not in runway_scene_ids
    ]

    if not images_to_animate:
        return ProductionStepResult(
            step_id="P5",
            status="complete",
            message="No images to animate (all have Runway clips)",
        )

    clips: list[dict[str, Any]] = []
    duration_per_scene = max(3.0, ctx.voiceover_duration / max(len(images_to_animate), 1))

    for img in images_to_animate:
        scene_id = img["scene_id"]
        frames_dir = ctx.output_dir / "visuals" / "frames" / f"scene_{scene_id:03d}"
        clip_path = ctx.output_dir / "visuals" / "ken_burns" / f"scene_{scene_id:03d}.mp4"

        # Generate frames
        kb.generate_frames(
            Path(img["path"]),
            frames_dir,
            duration_seconds=min(duration_per_scene, 8.0),
        )

        # Convert frames to video
        clip_path.parent.mkdir(parents=True, exist_ok=True)
        assembler.frames_to_video(frames_dir, clip_path)

        clips.append({
            "scene_id": scene_id,
            "path": str(clip_path),
            "status": "generated",
            "duration": duration_per_scene,
        })

    ctx.ken_burns_clips = clips

    return ProductionStepResult(
        step_id="P5",
        status="complete",
        message=f"Animated {len(clips)} scenes with Ken Burns effect",
        assets=[{"type": "ken_burns_clip", **c} for c in clips],
    )


# ═══════════════════════════════════════════════════════════
# P6: Motion Graphics & Text Overlays
# ═══════════════════════════════════════════════════════════


async def p6_motion_graphics(
    ctx: ProductionContext,
) -> ProductionStepResult:
    """P6: Render MOTION_GRAPHIC text cards and overlays."""
    from mindarchive.production.compositor import MotionGraphicRenderer
    from mindarchive.production.ffmpeg_assembler import FFmpegAssembler

    renderer = MotionGraphicRenderer()
    assembler = FFmpegAssembler()

    mg_scenes = _extract_tagged_scenes(ctx.final_script, "MOTION_GRAPHIC")
    if not mg_scenes:
        return ProductionStepResult(
            step_id="P6",
            status="complete",
            message="No MOTION_GRAPHIC tags to render",
        )

    cards: list[dict[str, Any]] = []
    for scene in mg_scenes:
        scene_id = scene["scene_id"]
        png_path = ctx.output_dir / "visuals" / "graphics" / f"mg_{scene_id:03d}.png"
        clip_path = ctx.output_dir / "visuals" / "graphics" / f"mg_{scene_id:03d}.mp4"

        # Determine style from content
        style = "stat" if any(c.isdigit() for c in scene["prompt"][:10]) else "clean"

        renderer.render_text_card(scene["prompt"], png_path, style=style)

        # Convert to video clip (3s default)
        assembler.image_to_video(png_path, clip_path, duration=3.0)

        cards.append({
            "scene_id": scene_id,
            "path": str(clip_path),
            "status": "generated",
        })

    ctx.motion_graphics = cards

    return ProductionStepResult(
        step_id="P6",
        status="complete",
        message=f"Rendered {len(cards)} motion graphic cards",
        assets=[{"type": "motion_graphic", **c} for c in cards],
    )


# ═══════════════════════════════════════════════════════════
# P7: Final Assembly
# ═══════════════════════════════════════════════════════════


async def p7_final_assembly(
    ctx: ProductionContext,
) -> ProductionStepResult:
    """P7: Assemble all visual clips + voiceover into the final video.

    The voiceover MP3 is the production clock — total video duration
    matches audio duration exactly.
    """
    from mindarchive.production.ffmpeg_assembler import FFmpegAssembler

    assembler = FFmpegAssembler()

    if not ctx.voiceover_path or not ctx.voiceover_path.exists():
        return ProductionStepResult(
            step_id="P7",
            status="error",
            error="Voiceover MP3 not found — cannot assemble without audio clock",
        )

    # Collect all clips in scene order
    all_clips = _build_timeline(ctx)
    if not all_clips:
        return ProductionStepResult(
            step_id="P7",
            status="error",
            error="No visual clips available for assembly",
        )

    # Concatenate visual clips
    visual_track = ctx.output_dir / "video" / "visual_track.mp4"
    clip_paths = [Path(c["path"]) for c in all_clips if c.get("path")]
    assembler.concatenate_clips(clip_paths, visual_track, transition="crossfade")
    ctx.visual_track_path = visual_track

    # Mix with voiceover (audio is the clock)
    final_path = ctx.output_dir / "video" / f"{ctx.project_slug}_final.mp4"

    # Prepend brand intro if available
    if ctx.brand_intro_path and ctx.brand_intro_path.exists():
        branded_visual = ctx.output_dir / "video" / "branded_visual.mp4"
        assembler.add_brand_intro(visual_track, ctx.brand_intro_path, branded_visual)
        visual_track = branded_visual

    assembler.mix_audio_video(visual_track, ctx.voiceover_path, final_path)
    ctx.final_video_path = final_path

    from mindarchive.production.ffmpeg_assembler import get_duration

    final_duration = get_duration(final_path)
    file_size = final_path.stat().st_size

    return ProductionStepResult(
        step_id="P7",
        status="complete",
        message=f"Final video: {final_duration:.1f}s, {file_size / 1_000_000:.1f} MB",
        assets=[{"type": "final_video", "path": str(final_path)}],
    )


# ═══════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════


def _extract_narration(script: str) -> str:
    """Extract narration-only text from a script (strip visual tags)."""
    cleaned = re.sub(r"\[(DALLE|RUNWAY|STOCK|MOTION_GRAPHIC):.*?\]", "", script, flags=re.DOTALL)
    cleaned = re.sub(r"\[.*?\]", "", cleaned)
    # Remove excessive whitespace
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def _extract_tagged_scenes(script: str, tag: str) -> list[dict[str, Any]]:
    """Extract scenes with a specific tag from the script.

    Returns list of dicts with 'scene_id' and 'prompt' keys.
    """
    pattern = rf"\[{tag}:\s*(.*?)\]"
    matches = re.findall(pattern, script, re.DOTALL)
    return [
        {"scene_id": i, "prompt": prompt.strip()}
        for i, prompt in enumerate(matches)
    ]


def _build_timeline(ctx: ProductionContext) -> list[dict[str, Any]]:
    """Build the visual timeline from all generated assets in scene order.

    Priority per scene:
    1. Runway clip (if generated)
    2. Ken Burns clip (if generated)
    3. Stock clip (if downloaded)
    4. Motion graphic card
    """
    # Index assets by scene_id
    runway_by_scene = {
        c["scene_id"]: c for c in ctx.runway_clips if c.get("status") == "generated"
    }
    kb_by_scene = {
        c["scene_id"]: c for c in ctx.ken_burns_clips if c.get("status") == "generated"
    }
    stock_by_scene = {
        c["scene_id"]: c for c in ctx.stock_clips if c.get("path")
    }
    mg_by_scene = {
        c["scene_id"]: c for c in ctx.motion_graphics if c.get("status") == "generated"
    }

    # Collect all scene IDs in order
    all_scene_ids = sorted(set(
        list(runway_by_scene.keys())
        + list(kb_by_scene.keys())
        + list(stock_by_scene.keys())
        + list(mg_by_scene.keys())
    ))

    timeline: list[dict[str, Any]] = []
    for scene_id in all_scene_ids:
        if scene_id in runway_by_scene:
            timeline.append(runway_by_scene[scene_id])
        elif scene_id in kb_by_scene:
            timeline.append(kb_by_scene[scene_id])
        elif scene_id in stock_by_scene:
            timeline.append(stock_by_scene[scene_id])
        elif scene_id in mg_by_scene:
            timeline.append(mg_by_scene[scene_id])

    return timeline
