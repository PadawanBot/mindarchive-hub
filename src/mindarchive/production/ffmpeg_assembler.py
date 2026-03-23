"""FFmpeg assembler — stitches audio, visuals, and overlays into final video."""

from __future__ import annotations

import json
import logging
import subprocess
from pathlib import Path
from typing import Any

from mindarchive.config.constants import OUTPUT_RESOLUTION, TRANSITION_DURATION_S

logger = logging.getLogger(__name__)


def _run_ffmpeg(args: list[str], description: str = "") -> subprocess.CompletedProcess:
    """Run an ffmpeg command with logging and error handling."""
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "warning"] + args
    logger.info("FFmpeg %s: %s", description, " ".join(cmd[:10]) + "...")
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if result.returncode != 0:
        logger.error("FFmpeg error: %s", result.stderr)
        raise RuntimeError(f"FFmpeg failed ({description}): {result.stderr[:500]}")
    return result


def _run_ffprobe(file_path: Path) -> dict[str, Any]:
    """Get media file info via ffprobe."""
    cmd = [
        "ffprobe", "-v", "quiet",
        "-print_format", "json",
        "-show_format", "-show_streams",
        str(file_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {result.stderr[:200]}")
    return json.loads(result.stdout)


def get_duration(file_path: Path) -> float:
    """Get duration of an audio or video file in seconds."""
    info = _run_ffprobe(file_path)
    duration = info.get("format", {}).get("duration")
    if duration:
        return float(duration)
    # Try stream duration
    for stream in info.get("streams", []):
        if stream.get("duration"):
            return float(stream["duration"])
    return 0.0


def get_audio_silence_points(audio_path: Path, threshold: float = -30.0) -> list[float]:
    """Detect silence points in audio using ffmpeg silencedetect.

    Returns list of timestamps (seconds) where silence occurs.
    Useful for syncing visual cuts to natural pauses in narration.
    """
    cmd = [
        "ffmpeg", "-i", str(audio_path),
        "-af", f"silencedetect=noise={threshold}dB:d=0.3",
        "-f", "null", "-",
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    stderr = result.stderr

    import re
    silence_times: list[float] = []
    for match in re.finditer(r"silence_start:\s*([\d.]+)", stderr):
        silence_times.append(float(match.group(1)))

    logger.info("Detected %d silence points in %s", len(silence_times), audio_path)
    return silence_times


class FFmpegAssembler:
    """Assembles the final video from component assets."""

    def __init__(self, output_resolution: tuple[int, int] = OUTPUT_RESOLUTION) -> None:
        self._resolution = output_resolution

    def image_to_video(
        self,
        image_path: Path,
        output_path: Path,
        duration: float,
        fps: int = 30,
    ) -> Path:
        """Convert a still image to a video clip of specified duration."""
        w, h = self._resolution
        _run_ffmpeg([
            "-loop", "1",
            "-i", str(image_path),
            "-c:v", "libx264",
            "-t", str(duration),
            "-pix_fmt", "yuv420p",
            "-vf", f"scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2",
            "-r", str(fps),
            str(output_path),
        ], f"image→video ({duration}s)")
        return output_path

    def frames_to_video(
        self,
        frames_dir: Path,
        output_path: Path,
        fps: int = 30,
    ) -> Path:
        """Convert a sequence of PNG frames to a video clip (for Ken Burns)."""
        _run_ffmpeg([
            "-framerate", str(fps),
            "-i", str(frames_dir / "frame_%05d.png"),
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            str(output_path),
        ], "frames→video")
        return output_path

    def scale_video(
        self,
        input_path: Path,
        output_path: Path,
    ) -> Path:
        """Scale a video clip to the target resolution with padding."""
        w, h = self._resolution
        _run_ffmpeg([
            "-i", str(input_path),
            "-vf", f"scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2",
            "-c:v", "libx264",
            "-c:a", "copy",
            str(output_path),
        ], "scale video")
        return output_path

    def trim_clip(
        self,
        input_path: Path,
        output_path: Path,
        start: float,
        duration: float,
    ) -> Path:
        """Trim a video clip to a specific time range."""
        _run_ffmpeg([
            "-ss", str(start),
            "-i", str(input_path),
            "-t", str(duration),
            "-c:v", "libx264",
            "-c:a", "copy",
            str(output_path),
        ], f"trim ({start}s, {duration}s)")
        return output_path

    def concatenate_clips(
        self,
        clip_paths: list[Path],
        output_path: Path,
        transition: str = "none",
    ) -> Path:
        """Concatenate video clips in sequence.

        Args:
            clip_paths: Ordered list of video clip paths.
            output_path: Where to save the concatenated video.
            transition: Transition type (none, crossfade).

        Returns:
            Path to the concatenated video.
        """
        if not clip_paths:
            raise ValueError("No clips to concatenate")

        if len(clip_paths) == 1:
            import shutil
            shutil.copy2(clip_paths[0], output_path)
            return output_path

        # Write concat file
        concat_file = output_path.parent / f"{output_path.stem}_concat.txt"
        with open(concat_file, "w") as f:
            for clip in clip_paths:
                f.write(f"file '{clip}'\n")

        if transition == "crossfade":
            # Use xfade filter for crossfade transitions
            return self._crossfade_concat(clip_paths, output_path)

        _run_ffmpeg([
            "-f", "concat",
            "-safe", "0",
            "-i", str(concat_file),
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            str(output_path),
        ], f"concatenate {len(clip_paths)} clips")

        # Clean up concat file
        concat_file.unlink(missing_ok=True)
        return output_path

    def _crossfade_concat(
        self,
        clip_paths: list[Path],
        output_path: Path,
    ) -> Path:
        """Concatenate clips with crossfade transitions using ffmpeg xfade."""
        if len(clip_paths) <= 1:
            return self.concatenate_clips(clip_paths, output_path)

        # Build complex xfade filter chain
        inputs: list[str] = []
        for clip in clip_paths:
            inputs.extend(["-i", str(clip)])

        # Build xfade filter
        n = len(clip_paths)
        fade_duration = TRANSITION_DURATION_S
        filter_parts: list[str] = []
        durations = [get_duration(p) for p in clip_paths]

        # Chain xfade filters
        offset = durations[0] - fade_duration
        prev = "0:v"
        for i in range(1, n):
            out_label = f"v{i}" if i < n - 1 else "vout"
            filter_parts.append(
                f"[{prev}][{i}:v]xfade=transition=fade:duration={fade_duration}:offset={offset}[{out_label}]"
            )
            if i < n - 1:
                offset += durations[i] - fade_duration
                prev = f"v{i}"

        filter_str = ";".join(filter_parts)

        _run_ffmpeg(
            inputs + [
                "-filter_complex", filter_str,
                "-map", "[vout]",
                "-c:v", "libx264",
                "-pix_fmt", "yuv420p",
                str(output_path),
            ],
            f"crossfade concat {n} clips",
        )
        return output_path

    def mix_audio_video(
        self,
        video_path: Path,
        audio_path: Path,
        output_path: Path,
        audio_offset: float = 0.0,
    ) -> Path:
        """Combine video and audio tracks into final output.

        The audio (voiceover MP3) is the production clock — video is trimmed
        or padded to match audio duration.
        """
        audio_duration = get_duration(audio_path)

        _run_ffmpeg([
            "-i", str(video_path),
            "-i", str(audio_path),
            "-c:v", "libx264",
            "-c:a", "aac",
            "-b:a", "192k",
            "-t", str(audio_duration),  # Audio is the clock
            "-map", "0:v:0",
            "-map", "1:a:0",
            "-shortest",
            str(output_path),
        ], "mix audio+video")

        logger.info("Final video: %s (%.1fs)", output_path, audio_duration)
        return output_path

    def add_brand_intro(
        self,
        video_path: Path,
        intro_path: Path,
        output_path: Path,
    ) -> Path:
        """Prepend a brand intro clip to the main video."""
        return self.concatenate_clips([intro_path, video_path], output_path, transition="crossfade")

    def generate_waveform_video(
        self,
        audio_path: Path,
        output_path: Path,
        duration: float | None = None,
        color: str = "0x1abc9c",
    ) -> Path:
        """Generate an audio waveform visualization video (for debugging/preview)."""
        dur = duration or get_duration(audio_path)
        w, h = self._resolution
        _run_ffmpeg([
            "-i", str(audio_path),
            "-filter_complex",
            f"[0:a]showwaves=s={w}x{h}:mode=cline:colors={color}:rate=30[v]",
            "-map", "[v]",
            "-map", "0:a",
            "-c:v", "libx264",
            "-c:a", "aac",
            "-t", str(dur),
            str(output_path),
        ], "waveform video")
        return output_path
