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

/**
 * Parse a pipe-delimited spec string from the manifest into a MotionGraphicSpec.
 *
 * Spec format (from manifest-builder):
 *   layout=title_card | text="TITLE / Subtitle" | white #F0F0F4 on near-black #0D0D14 | accent teal #1ABC9C
 *   layout=list_card  | title="THE BITE MODEL"  | items="Item 1 | Item 2 | Item 3" | accent teal #1ABC9C
 *   layout=end_card   | text="Subscribe | MindArchive" | accent teal #1ABC9C
 */
function parseMotionGraphicSpec(specString: string, fallbackLabel?: string): MotionGraphicSpec {
  const spec: MotionGraphicSpec = {};

  // layout=
  const layoutMatch = specString.match(/layout=(\w+)/);
  const layout = layoutMatch?.[1] || "title_card";

  // text="..." — main text, may contain " | " inside quotes
  const textMatch = specString.match(/\btext="([^"]+)"/);
  if (textMatch) {
    const parts = textMatch[1].split(" / ");
    spec.title = parts[0].trim();
    if (parts[1]) spec.body = parts[1].trim();
  }

  // title="..." — explicit title for list/checklist cards
  const titleMatch = specString.match(/\btitle="([^"]+)"/);
  if (titleMatch) spec.title = titleMatch[1];

  // items="A | B | C" — bullet points
  const itemsMatch = specString.match(/\bitems="([^"]+)"/);
  if (itemsMatch) {
    spec.bullets = itemsMatch[1].split("|").map((s) => s.trim()).filter(Boolean);
  }

  // accent X #RRGGBB
  const accentMatch = specString.match(/accent\s+\w+\s+(#[0-9a-fA-F]{6})/i);
  if (accentMatch) spec.accentColor = accentMatch[1];

  // near-black #RRGGBB → background
  const bgMatch = specString.match(/near-black\s+(#[0-9a-fA-F]{6})/i);
  if (bgMatch) spec.backgroundColor = bgMatch[1];

  // For end cards, treat title as footer (large centred subscription prompt)
  if (layout === "end_card" && spec.title) {
    spec.footer = spec.title;
    spec.title = undefined;
    spec.body = undefined;
  }

  // Fallback: nothing parsed — use scene label as plain title card
  if (!spec.title && !spec.body && !spec.bullets?.length && !spec.footer) {
    spec.title = fallbackLabel || "MindArchive";
  }

  return spec;
}

/**
 * Generate a motion graphic PNG from a pipe-delimited spec string.
 * Called by the assembler for MOTION_GRAPHIC scenes with no pre-uploaded imageUrl.
 */
export async function renderMotionGraphicFromSpec(
  specString: string,
  outputPath: string,
  fallbackLabel?: string
): Promise<void> {
  const spec = parseMotionGraphicSpec(specString, fallbackLabel);
  await renderMotionGraphic(spec, outputPath);
}
