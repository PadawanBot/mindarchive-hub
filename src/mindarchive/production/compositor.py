"""Pillow compositor — text overlays, thumbnail compositing, Ken Burns frame generation."""

from __future__ import annotations

import logging
import math
import random
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

from mindarchive.config.constants import (
    KEN_BURNS_MOTION_TYPES,
    KEN_BURNS_PAN_RANGE_PX,
    KEN_BURNS_ZOOM_RANGE,
    OUTPUT_RESOLUTION,
    SHORTS_RESOLUTION,
    THUMBNAIL_JPEG_QUALITY,
    THUMBNAIL_RESOLUTION,
)

logger = logging.getLogger(__name__)

# Default font paths (common cross-platform locations)
_FONT_SEARCH_PATHS = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "C:/Windows/Fonts/arial.ttf",
]


def _find_font(bold: bool = True) -> str | None:
    """Find a usable system font."""
    for path in _FONT_SEARCH_PATHS:
        if Path(path).exists():
            return path
    return None


class ThumbnailCompositor:
    """Generates YouTube thumbnails: DALL-E base image + Pillow text overlays."""

    def compose(
        self,
        base_image_path: Path,
        text: str,
        output_path: Path,
        font_size: int = 72,
        font_color: str = "#FFFFFF",
        stroke_color: str = "#000000",
        stroke_width: int = 4,
        position: str = "center",
        overlay_darken: float = 0.0,
    ) -> Path:
        """Compose a thumbnail from a base image and text overlay.

        CRITICAL: All text is added here by Pillow, never in DALL-E prompts.

        Args:
            base_image_path: Path to DALL-E generated base image.
            text: Thumbnail text (under 4 words recommended).
            output_path: Where to save the final thumbnail.
            font_size: Text size in pixels.
            font_color: Text color (hex).
            stroke_color: Text stroke/outline color.
            stroke_width: Stroke width in pixels.
            position: Text position: center, top, bottom, bottom_left.
            overlay_darken: Darken the image (0.0 = none, 0.5 = 50% darker).

        Returns:
            Path to the composited thumbnail.
        """
        img = Image.open(base_image_path).convert("RGB")
        img = img.resize(THUMBNAIL_RESOLUTION, Image.LANCZOS)

        # Apply darkening overlay for text readability
        if overlay_darken > 0:
            enhancer = ImageEnhance.Brightness(img)
            img = enhancer.enhance(1.0 - overlay_darken)

        draw = ImageDraw.Draw(img)

        # Load font
        font_path = _find_font()
        try:
            font = ImageFont.truetype(font_path, font_size) if font_path else ImageFont.load_default()
        except Exception:
            font = ImageFont.load_default()

        # Calculate text position
        bbox = draw.textbbox((0, 0), text, font=font)
        text_width = bbox[2] - bbox[0]
        text_height = bbox[3] - bbox[1]

        w, h = img.size
        x, y = _calculate_position(position, w, h, text_width, text_height)

        # Draw text with stroke
        draw.text(
            (x, y),
            text,
            font=font,
            fill=font_color,
            stroke_width=stroke_width,
            stroke_fill=stroke_color,
        )

        output_path.parent.mkdir(parents=True, exist_ok=True)
        img.save(output_path, "JPEG", quality=THUMBNAIL_JPEG_QUALITY)
        logger.info("Thumbnail saved: %s", output_path)
        return output_path


class MotionGraphicRenderer:
    """Renders MOTION_GRAPHIC text cards as PNG frames for video compositing."""

    def render_text_card(
        self,
        text: str,
        output_path: Path,
        resolution: tuple[int, int] = OUTPUT_RESOLUTION,
        font_size: int = 54,
        font_color: str = "#FFFFFF",
        bg_color: str = "#1a1a2e",
        accent_color: str = "#1abc9c",
        style: str = "clean",
    ) -> Path:
        """Render a motion graphic text card as a PNG image.

        These are visual supplements that appear alongside narration,
        NOT replacements for it.

        Args:
            text: The text/data to display.
            output_path: Where to save the PNG.
            resolution: Output resolution.
            font_size: Text size.
            font_color: Text color.
            bg_color: Background color.
            accent_color: Accent/highlight color.
            style: Card style: clean, stat, quote, list.

        Returns:
            Path to the rendered PNG.
        """
        img = Image.new("RGB", resolution, bg_color)
        draw = ImageDraw.Draw(img)

        font_path = _find_font()
        try:
            font = ImageFont.truetype(font_path, font_size) if font_path else ImageFont.load_default()
            small_font = ImageFont.truetype(font_path, font_size // 2) if font_path else ImageFont.load_default()
        except Exception:
            font = ImageFont.load_default()
            small_font = font

        w, h = resolution

        if style == "stat":
            # Big number/stat with label below
            lines = text.split("\n", 1)
            stat_text = lines[0]
            label = lines[1] if len(lines) > 1 else ""

            # Draw accent line
            draw.rectangle([(w // 2 - 100, h // 2 - 80), (w // 2 + 100, h // 2 - 76)], fill=accent_color)

            # Draw stat
            bbox = draw.textbbox((0, 0), stat_text, font=font)
            tx = (w - (bbox[2] - bbox[0])) // 2
            draw.text((tx, h // 2 - 60), stat_text, font=font, fill=accent_color)

            # Draw label
            if label:
                bbox2 = draw.textbbox((0, 0), label, font=small_font)
                tx2 = (w - (bbox2[2] - bbox2[0])) // 2
                draw.text((tx2, h // 2 + 20), label, font=small_font, fill=font_color)

        elif style == "quote":
            # Centered quote with accent marks
            draw.text((w // 2 - 30, h // 2 - 100), '"', font=font, fill=accent_color)
            _draw_wrapped_text(draw, text, font, w, h, font_color, max_width=int(w * 0.7))
            draw.text((w // 2 + 20, h // 2 + 60), '"', font=font, fill=accent_color)

        else:
            # Clean centered text
            _draw_wrapped_text(draw, text, font, w, h, font_color, max_width=int(w * 0.8))

        output_path.parent.mkdir(parents=True, exist_ok=True)
        img.save(output_path, "PNG")
        logger.info("Motion graphic saved: %s", output_path)
        return output_path


class KenBurnsGenerator:
    """Generates Ken Burns pan/zoom frame sequences from still images."""

    def generate_frames(
        self,
        image_path: Path,
        output_dir: Path,
        duration_seconds: float,
        fps: int = 30,
        motion_type: str | None = None,
        output_resolution: tuple[int, int] = OUTPUT_RESOLUTION,
    ) -> list[Path]:
        """Generate a sequence of frames with Ken Burns effect.

        Args:
            image_path: Source still image.
            output_dir: Directory for frame PNGs.
            duration_seconds: Total animation duration.
            fps: Frames per second.
            motion_type: slow_zoom_in, slow_zoom_out, or lateral_pan.
            output_resolution: Size for each output frame.

        Returns:
            List of paths to frame PNGs.
        """
        img = Image.open(image_path).convert("RGB")

        if motion_type is None:
            motion_type = random.choice(KEN_BURNS_MOTION_TYPES)

        total_frames = int(duration_seconds * fps)
        zoom_min, zoom_max = KEN_BURNS_ZOOM_RANGE
        pan_min, pan_max = KEN_BURNS_PAN_RANGE_PX

        output_dir.mkdir(parents=True, exist_ok=True)
        frame_paths: list[Path] = []

        src_w, src_h = img.size
        out_w, out_h = output_resolution

        for i in range(total_frames):
            t = i / max(total_frames - 1, 1)  # 0.0 → 1.0

            if motion_type == "slow_zoom_in":
                scale = 1.0 + (zoom_max - 1.0) * t
                cx, cy = src_w / 2, src_h / 2
            elif motion_type == "slow_zoom_out":
                scale = zoom_max - (zoom_max - 1.0) * t
                cx, cy = src_w / 2, src_h / 2
            else:  # lateral_pan
                scale = (zoom_min + zoom_max) / 2
                pan_total = random.randint(pan_min, pan_max)
                cx = src_w / 2 + pan_total * (t - 0.5)
                cy = src_h / 2

            # Calculate crop box
            crop_w = out_w / scale
            crop_h = out_h / scale

            left = max(0, cx - crop_w / 2)
            top = max(0, cy - crop_h / 2)
            right = min(src_w, left + crop_w)
            bottom = min(src_h, top + crop_h)

            # Adjust if crop goes out of bounds
            if right - left < crop_w:
                left = max(0, right - crop_w)
            if bottom - top < crop_h:
                top = max(0, bottom - crop_h)

            frame = img.crop((int(left), int(top), int(right), int(bottom)))
            frame = frame.resize(output_resolution, Image.LANCZOS)

            frame_path = output_dir / f"frame_{i:05d}.png"
            frame.save(frame_path, "PNG")
            frame_paths.append(frame_path)

        logger.info(
            "Ken Burns: %d frames (%s, %.1fs) → %s",
            total_frames,
            motion_type,
            duration_seconds,
            output_dir,
        )
        return frame_paths


# ─── Helpers ───

def _calculate_position(
    position: str,
    img_w: int,
    img_h: int,
    text_w: int,
    text_h: int,
) -> tuple[int, int]:
    """Calculate text position on the image."""
    margin = 40
    if position == "center":
        return (img_w - text_w) // 2, (img_h - text_h) // 2
    elif position == "top":
        return (img_w - text_w) // 2, margin
    elif position == "bottom":
        return (img_w - text_w) // 2, img_h - text_h - margin
    elif position == "bottom_left":
        return margin, img_h - text_h - margin
    return (img_w - text_w) // 2, (img_h - text_h) // 2


def _draw_wrapped_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.FreeTypeFont,
    canvas_w: int,
    canvas_h: int,
    color: str,
    max_width: int = 1400,
) -> None:
    """Draw text with word wrapping, centered on the canvas."""
    words = text.split()
    lines: list[str] = []
    current_line = ""

    for word in words:
        test_line = f"{current_line} {word}".strip()
        bbox = draw.textbbox((0, 0), test_line, font=font)
        if bbox[2] - bbox[0] <= max_width:
            current_line = test_line
        else:
            if current_line:
                lines.append(current_line)
            current_line = word
    if current_line:
        lines.append(current_line)

    # Calculate total height
    line_height = draw.textbbox((0, 0), "Ay", font=font)[3] + 8
    total_height = line_height * len(lines)
    start_y = (canvas_h - total_height) // 2

    for i, line in enumerate(lines):
        bbox = draw.textbbox((0, 0), line, font=font)
        line_w = bbox[2] - bbox[0]
        x = (canvas_w - line_w) // 2
        y = start_y + i * line_height
        draw.text((x, y), line, font=font, fill=color)
