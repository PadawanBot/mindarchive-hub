/**
 * Motion graphic card renderer — ffmpeg drawtext (no sharp dependency).
 *
 * Renders text cards (title cards, data overlays, end cards) as PNG stills.
 * Uses ffmpeg lavfi color source + drawtext filters.
 * 7% safe margins from each edge for landscape + portrait safety.
 */

import { execFile } from "child_process";
import { promisify } from "util";

const exec = promisify(execFile);
const FFMPEG = "ffmpeg";

const MARGIN_X_PERCENT = 0.07;
const MARGIN_Y_PERCENT = 0.07;

export interface MotionGraphicSpec {
  title?: string;
  body?: string;
  bullets?: string[];
  footer?: string;
  backgroundColor?: string;
  textColor?: string;
  accentColor?: string;
  fontSize?: number;
  width?: number;
  height?: number;
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
    .replace(/%/g, "%%")
    .replace(/\n/g, "\\n");
}

/**
 * Render a motion graphic card as a PNG file.
 * Uses ffmpeg lavfi color source + drawtext filters.
 *
 * @param spec  Card content and styling
 * @param outputPath  Path to write the PNG
 */
export async function renderMotionGraphic(
  spec: MotionGraphicSpec,
  outputPath: string
): Promise<void> {
  const width = spec.width || 1920;
  const height = spec.height || 1080;
  const marginX = Math.round(width * MARGIN_X_PERCENT);
  const marginY = Math.round(height * MARGIN_Y_PERCENT);

  const bgColor = (spec.backgroundColor || "#1a1a2e").replace("#", "0x");
  const textColor = (spec.textColor || "#ffffff").replace("#", "0x");
  const accentColor = (spec.accentColor || "#e94560").replace("#", "0x");
  const baseFontSize = spec.fontSize || 48;

  // Build drawtext filter chain
  const filters: string[] = [];
  let y = marginY;

  // Title
  if (spec.title) {
    const titleSize = Math.round(baseFontSize * 1.4);
    filters.push(
      `drawtext=text='${escapeDrawtext(spec.title)}'` +
      `:x=${marginX}:y=${y}` +
      `:fontsize=${titleSize}:fontcolor=${accentColor}` +
      `:font=Arial`
    );
    y += Math.round(titleSize * 1.6);
  }

  // Body text
  if (spec.body) {
    filters.push(
      `drawtext=text='${escapeDrawtext(spec.body)}'` +
      `:x=${marginX}:y=${y}` +
      `:fontsize=${baseFontSize}:fontcolor=${textColor}` +
      `:font=Arial`
    );
    y += Math.round(baseFontSize * 1.5 * Math.ceil(spec.body.length / 60));
  }

  // Bullet points
  if (spec.bullets?.length) {
    for (const bullet of spec.bullets) {
      const bulletText = `\u2022  ${bullet}`;
      filters.push(
        `drawtext=text='${escapeDrawtext(bulletText)}'` +
        `:x=${marginX + Math.round(baseFontSize * 0.5)}:y=${y}` +
        `:fontsize=${Math.round(baseFontSize * 0.9)}:fontcolor=${textColor}` +
        `:font=Arial`
      );
      y += Math.round(baseFontSize * 1.4);
    }
  }

  // Footer (anchored to bottom)
  if (spec.footer) {
    const footerY = height - marginY - Math.round(baseFontSize * 0.7);
    filters.push(
      `drawtext=text='${escapeDrawtext(spec.footer)}'` +
      `:x=${marginX}:y=${footerY}` +
      `:fontsize=${Math.round(baseFontSize * 0.7)}:fontcolor=${textColor}@0.7` +
      `:font=Arial`
    );
  }

  // If no text at all, just produce a solid color frame
  const vf = filters.length > 0 ? `,${filters.join(",")}` : "";

  const args = [
    "-y",
    "-f", "lavfi",
    "-i", `color=c=${bgColor}:s=${width}x${height}:d=1`,
    "-vf", `format=rgb24${vf}`,
    "-frames:v", "1",
    outputPath,
  ];

  try {
    await exec(FFMPEG, args, { maxBuffer: 10 * 1024 * 1024 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const stderr =
      typeof err === "object" && err !== null && "stderr" in err
        ? (err as { stderr: string }).stderr?.slice(-500)
        : "";
    throw new Error(`[motion-graphic] ffmpeg failed: ${msg}\n${stderr}`);
  }
}
