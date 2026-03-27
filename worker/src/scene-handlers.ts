/**
 * Scene handlers — create standardized clips for each asset type.
 *
 * Each handler takes an input file and produces a clip at the target
 * resolution/fps/duration. All ffmpeg commands match the Python render
 * script (src/lib/video/render-package.ts:296-534) exactly.
 */

import { execFile } from "child_process";
import { promisify } from "util";

const exec = promisify(execFile);

const FFMPEG = "ffmpeg";

interface Resolution {
  width: number;
  height: number;
}

/**
 * Run ffmpeg with args. Rejects on non-zero exit code.
 */
async function runFfmpeg(args: string[], desc: string): Promise<void> {
  try {
    await exec(FFMPEG, ["-y", ...args], { maxBuffer: 50 * 1024 * 1024 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const stderr =
      typeof err === "object" && err !== null && "stderr" in err
        ? (err as { stderr: string }).stderr?.slice(-500)
        : "";
    throw new Error(`[${desc}] ffmpeg failed: ${msg}\n${stderr}`);
  }
}

// ── DALLE scenes: Ken Burns with 3 motion variants ──

/**
 * Port of create_dalle_clip() from Python render script (lines 343-381).
 * Scale image to 3840x2160 first, then zoompan to target resolution.
 * Three smoothstep-eased motion variants rotate per scene index.
 */
export async function prepareDalleScene(
  imagePath: string,
  outputPath: string,
  duration: number,
  resolution: Resolution,
  fps: number,
  variant: 0 | 1 | 2,
  preset: string,
  crf: number
): Promise<void> {
  const d = Math.ceil(duration * fps);
  const w = resolution.width;
  const h = resolution.height;

  // smoothstep for ffmpeg: st(1,clip(ld(0),0,1));st(1,ld(1)*ld(1)*(3-2*ld(1)));ld(1)
  const smooth = "st(1,clip(ld(0),0,1));st(1,ld(1)*ld(1)*(3-2*ld(1)));ld(1)";

  let zoomExpr: string;
  let xExpr: string;
  let yExpr: string;

  if (variant === 0) {
    // Zoom in (1.0 -> 1.08)
    zoomExpr = `min(1.0+0.08*(st(0,on/${d});${smooth}),1.08)`;
    xExpr = "iw/2-(iw/zoom/2)";
    yExpr = "ih/2-(ih/zoom/2)";
  } else if (variant === 1) {
    // Zoom out (1.08 -> 1.0)
    zoomExpr = `max(1.08-0.08*(st(0,on/${d});${smooth}),1.0)`;
    xExpr = "iw/2-(iw/zoom/2)";
    yExpr = "ih/2-(ih/zoom/2)";
  } else {
    // Pan right with slight zoom
    zoomExpr = `min(1.0+0.03*(st(0,on/${d});${smooth}),1.03)`;
    xExpr = `(iw-iw/zoom)*(st(0,on/${d});${smooth})`;
    yExpr = "ih/2-(ih/zoom/2)";
  }

  const vf =
    `scale=3840:2160:force_original_aspect_ratio=decrease,` +
    `pad=3840:2160:(ow-iw)/2:(oh-ih)/2:black,` +
    `zoompan=z='${zoomExpr}':x='${xExpr}':y='${yExpr}'` +
    `:d=${d}:s=${w}x${h}:fps=${fps}`;

  await runFfmpeg(
    [
      "-loop", "1",
      "-i", imagePath,
      "-vf", vf,
      "-c:v", "libx264",
      "-preset", preset,
      "-crf", String(crf),
      "-t", String(duration),
      "-pix_fmt", "yuv420p",
      "-r", String(fps),
      outputPath,
    ],
    `DALLE scene (variant ${variant})`
  );
}

// ── STOCK / RUNWAY scenes: scale, crop, loop if needed ──

/**
 * Port of create_video_clip() from Python render script (lines 402-411).
 * Scales/crops video to target resolution, loops with -stream_loop -1 if shorter.
 */
export async function prepareVideoScene(
  videoPath: string,
  outputPath: string,
  duration: number,
  resolution: Resolution,
  fps: number,
  preset: string,
  crf: number
): Promise<void> {
  const vf =
    `scale=${resolution.width}:${resolution.height}:force_original_aspect_ratio=decrease,` +
    `pad=${resolution.width}:${resolution.height}:(ow-iw)/2:(oh-ih)/2:black`;

  await runFfmpeg(
    [
      "-stream_loop", "-1",
      "-i", videoPath,
      "-vf", vf,
      "-c:v", "libx264",
      "-preset", preset,
      "-crf", String(crf),
      "-t", String(duration),
      "-pix_fmt", "yuv420p",
      "-an", // strip source audio — voiceover is the only audio track
      "-r", String(fps),
      outputPath,
    ],
    "VIDEO scene"
  );
}

// ── MOTION_GRAPHIC scenes: PNG still with subtle zoom + fade ──

/**
 * Port of create_motion_graphic_clip() from Python render script (lines 383-400).
 * Subtle zoom (1.0→1.02) with fade in/out on PNG stills.
 */
export async function prepareMotionGraphicScene(
  imagePath: string,
  outputPath: string,
  duration: number,
  resolution: Resolution,
  fps: number,
  preset: string,
  crf: number
): Promise<void> {
  const d = Math.ceil(duration * fps);
  const fadeFrames = 12; // ~0.5s at 25fps

  const vf =
    `scale=3840:2160:force_original_aspect_ratio=decrease,` +
    `pad=3840:2160:(ow-iw)/2:(oh-ih)/2:black,` +
    `zoompan=z='min(1.0+0.02*(on/${d}),1.02)'` +
    `:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'` +
    `:d=${d}:s=${resolution.width}x${resolution.height}:fps=${fps},` +
    `fade=in:0:${fadeFrames},fade=out:${d - fadeFrames}:${fadeFrames}`;

  await runFfmpeg(
    [
      "-loop", "1",
      "-i", imagePath,
      "-vf", vf,
      "-c:v", "libx264",
      "-preset", preset,
      "-crf", String(crf),
      "-t", String(duration),
      "-pix_fmt", "yuv420p",
      "-r", String(fps),
      outputPath,
    ],
    "MOTION_GRAPHIC scene"
  );
}

// ── End card / black fallback ──

/**
 * Port of create_end_card() from Python render script (lines 413-419).
 * Solid dark background — used as fallback when no asset file exists.
 */
export async function prepareEndCard(
  outputPath: string,
  duration: number,
  resolution: Resolution,
  fps: number,
  preset: string,
  crf: number
): Promise<void> {
  await runFfmpeg(
    [
      "-f", "lavfi",
      "-i", `color=c=0x0D0D1A:s=${resolution.width}x${resolution.height}:d=${duration}:r=${fps}`,
      "-c:v", "libx264",
      "-preset", preset,
      "-crf", String(crf),
      "-pix_fmt", "yuv420p",
      outputPath,
    ],
    "End card"
  );
}

// ── Combined audio builder ──

/**
 * Concatenate brand music + voiceover into a single audio track.
 * Brand music plays first (intro), then voiceover follows.
 */
export async function buildCombinedAudio(
  brandMusicPath: string,
  voiceoverPath: string,
  outputPath: string
): Promise<void> {
  await runFfmpeg(
    [
      "-i", brandMusicPath,
      "-i", voiceoverPath,
      "-filter_complex", "[0:a][1:a]concat=n=2:v=0:a=1[outa]",
      "-map", "[outa]",
      "-c:a", "aac",
      "-b:a", "192k",
      outputPath,
    ],
    "Combined audio"
  );
}

// ── Portrait crop pass ──

/**
 * Port of vertical version from Python render script (lines 518-524).
 * Crops landscape to 9:16 center and scales to portrait resolution.
 */
export async function createPortraitVersion(
  landscapePath: string,
  outputPath: string,
  portraitResolution: Resolution,
  preset: string,
  crf: number
): Promise<void> {
  await runFfmpeg(
    [
      "-i", landscapePath,
      "-vf", `crop=ih*9/16:ih,scale=${portraitResolution.width}:${portraitResolution.height}`,
      "-c:v", "libx264",
      "-preset", preset,
      "-crf", String(crf),
      "-c:a", "copy",
      "-movflags", "+faststart",
      outputPath,
    ],
    "Portrait version"
  );
}
