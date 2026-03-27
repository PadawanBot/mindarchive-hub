/**
 * Filter graph builder — constructs ffmpeg arguments for the final composite.
 *
 * Two paths:
 * 1. Simple: all transitions are "cut" → concat demuxer (fast, no re-encode)
 * 2. Crossfade: any "fade"/"dissolve" → filter_complex with xfade chain + drawtext
 */

import type { LowerThird, TransitionType } from "./types";

const CROSSFADE_DURATION = 0.5; // seconds

interface ClipInfo {
  path: string;
  duration: number;
  transitionOut: TransitionType;
}

/**
 * Map our transition types to ffmpeg xfade transition names.
 */
function xfadeTransition(t: TransitionType): string {
  switch (t) {
    case "dissolve": return "dissolve";
    case "fade": return "fade";
    case "cut": return "fade"; // shouldn't reach here but safe default
    default: return "fade";
  }
}

/**
 * Escape text for ffmpeg drawtext filter.
 * Must escape : ' \ and newlines.
 */
function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, "\\\\\\\\")
    .replace(/'/g, "'\\\\\\''")
    .replace(/:/g, "\\\\:")
    .replace(/\n/g, "");
}

/**
 * Build ffmpeg args for the final composite command.
 *
 * @param clips - Ordered list of prepared clip files with durations
 * @param audioPath - Combined audio file (brand music + voiceover)
 * @param lowerThirds - Text overlay specs
 * @param outputPath - Final output MP4 path
 * @param fps - Target framerate
 * @returns ffmpeg argument array (without leading "ffmpeg")
 */
export function buildFfmpegArgs(
  clips: ClipInfo[],
  audioPath: string,
  lowerThirds: LowerThird[],
  outputPath: string,
  fps: number
): string[] {
  if (clips.length === 0) {
    throw new Error("No clips provided to filter graph builder");
  }

  const hasCrossfades = clips.some(
    (c, i) => i < clips.length - 1 && c.transitionOut !== "cut"
  );

  if (!hasCrossfades && lowerThirds.length === 0) {
    return buildConcatArgs(clips, audioPath, outputPath);
  }

  return buildFilterComplexArgs(clips, audioPath, lowerThirds, outputPath, fps);
}

/**
 * Simple concat path — no crossfades, no overlays. Uses concat demuxer.
 */
function buildConcatArgs(
  clips: ClipInfo[],
  audioPath: string,
  outputPath: string
): string[] {
  // We'll write the concat file content as a pipe input
  // Instead, return args that expect a concat file to already exist.
  // The caller must write the concat file first.
  // For simplicity, we build an approach using the concat protocol directly.

  // Build a complex filter that just concatenates without re-encode overhead:
  // Actually, concat demuxer requires a file — the caller handles that.
  // Let's use filter_complex concat even for the simple case to keep it uniform.

  const args: string[] = [];

  // Input files
  for (const clip of clips) {
    args.push("-i", clip.path);
  }
  args.push("-i", audioPath);

  const audioIdx = clips.length;

  // Build filter: concat all video streams
  const inputs = clips.map((_, i) => `[${i}:v]`).join("");
  const filterComplex = `${inputs}concat=n=${clips.length}:v=1:a=0[vout]`;

  args.push(
    "-filter_complex", filterComplex,
    "-map", "[vout]",
    "-map", `${audioIdx}:a`,
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "18",
    "-c:a", "aac",
    "-b:a", "192k",
    "-shortest",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    outputPath
  );

  return args;
}

/**
 * Full filter_complex path with xfade transitions and drawtext overlays.
 *
 * Filter graph structure:
 *   [0:v][1:v]xfade=...[v01];
 *   [v01][2:v]xfade=...[v012];
 *   ...
 *   [vN]drawtext=...,drawtext=...[vfinal];
 */
function buildFilterComplexArgs(
  clips: ClipInfo[],
  audioPath: string,
  lowerThirds: LowerThird[],
  outputPath: string,
  fps: number
): string[] {
  const args: string[] = [];

  // Input files
  for (const clip of clips) {
    args.push("-i", clip.path);
  }
  args.push("-i", audioPath);

  const audioIdx = clips.length;

  // Build xfade chain
  const filterParts: string[] = [];
  let currentLabel = "[0:v]";
  let cumulativeOffset = 0;

  if (clips.length === 1) {
    // Single clip, no xfade needed
    currentLabel = "[0:v]";
    cumulativeOffset = clips[0].duration;
  } else {
    // First clip's duration contributes to the offset
    cumulativeOffset = clips[0].duration;

    for (let i = 1; i < clips.length; i++) {
      const prevClip = clips[i - 1];
      const transition = prevClip.transitionOut;

      if (transition === "cut") {
        // No crossfade — just concat this pair
        // For simplicity, treat "cut" as a very short fade (1 frame)
        const offset = Math.max(cumulativeOffset - (1 / fps), 0);
        const outLabel = i < clips.length - 1 ? `[v${i}]` : "[vxfade]";
        filterParts.push(
          `${currentLabel}[${i}:v]xfade=transition=fade:duration=${1 / fps}:offset=${offset.toFixed(4)}${outLabel}`
        );
        currentLabel = outLabel;
        cumulativeOffset = offset + clips[i].duration;
      } else {
        // Crossfade transition
        const offset = Math.max(cumulativeOffset - CROSSFADE_DURATION, 0);
        const outLabel = i < clips.length - 1 ? `[v${i}]` : "[vxfade]";
        filterParts.push(
          `${currentLabel}[${i}:v]xfade=transition=${xfadeTransition(transition)}:duration=${CROSSFADE_DURATION}:offset=${offset.toFixed(4)}${outLabel}`
        );
        currentLabel = outLabel;
        // After xfade, the cumulative duration is offset + next clip duration
        cumulativeOffset = offset + clips[i].duration;
      }
    }
  }

  // Build drawtext chain for lower thirds
  let finalLabel: string;
  if (lowerThirds.length > 0) {
    const drawtexts = lowerThirds.map((lt) => {
      const escapedText = escapeDrawtext(lt.text);
      return (
        `drawtext=text='${escapedText}'` +
        `:enable='between(t,${lt.startTime},${lt.endTime})'` +
        `:x=${lt.x}:y=${lt.y}` +
        `:fontsize=${lt.fontSize}` +
        `:fontcolor=${lt.color || "white"}` +
        `:box=1:boxcolor=${lt.bgColor || "black@0.6"}:boxborderw=10`
      );
    });

    const srcLabel = clips.length === 1 ? "[0:v]" : "[vxfade]";
    filterParts.push(`${srcLabel}${drawtexts.join(",")}[vfinal]`);
    finalLabel = "[vfinal]";
  } else {
    finalLabel = clips.length === 1 ? "[0:v]" : "[vxfade]";
  }

  const filterComplex = filterParts.join(";\n");

  args.push(
    "-filter_complex", filterComplex,
    "-map", finalLabel,
    "-map", `${audioIdx}:a`,
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "18",
    "-c:a", "aac",
    "-b:a", "192k",
    "-shortest",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    outputPath
  );

  return args;
}
