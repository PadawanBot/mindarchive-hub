/**
 * Motion graphic card renderer — Puppeteer HTML/CSS.
 *
 * Renders text cards (title cards, list cards, checklists, end cards) as
 * high-quality PNG stills using headless Chrome. Supports gradients, shadows,
 * accent bars, and clean typography — a significant upgrade over ffmpeg drawtext.
 *
 * The shared browser instance is reused across requests and cleaned up on exit.
 */

import puppeteer, { type Browser } from "puppeteer";

// ─── Shared browser instance ─────────────────────────────────────────────────

let _browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (_browser && _browser.connected) return _browser;
  _browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });
  return _browser;
}

// Clean up on process exit
process.on("exit", () => { _browser?.close().catch(() => {}); });

// ─── Types ───────────────────────────────────────────────────────────────────

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

// ─── CSS Helpers ─────────────────────────────────────────────────────────────

/** Lighten a hex color by a percentage (0-1) for gradient endpoints. */
function lighten(hex: string, amount: number): string {
  const c = hex.replace("#", "");
  const r = Math.min(255, parseInt(c.slice(0, 2), 16) + Math.round(255 * amount));
  const g = Math.min(255, parseInt(c.slice(2, 4), 16) + Math.round(255 * amount));
  const b = Math.min(255, parseInt(c.slice(4, 6), 16) + Math.round(255 * amount));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── HTML Template Builder ───────────────────────────────────────────────────

function buildHTML(spec: MotionGraphicSpec, layout: string): string {
  const bg = spec.backgroundColor || "#0D0D14";
  const text = spec.textColor || "#F0F0F4";
  const accent = spec.accentColor || "#1ABC9C";
  const bgLight = lighten(bg, 0.06);
  const width = spec.width || 1920;
  const height = spec.height || 1080;
  const baseFontSize = spec.fontSize || 48;

  const titleHTML = spec.title
    ? `<div class="title">${esc(spec.title)}</div>`
    : "";
  const bodyHTML = spec.body
    ? `<div class="body">${esc(spec.body)}</div>`
    : "";
  const bulletsHTML = spec.bullets?.length
    ? `<ul class="bullets">${spec.bullets.map(b => `<li>${esc(b)}</li>`).join("")}</ul>`
    : "";
  const footerHTML = spec.footer
    ? `<div class="footer">${esc(spec.footer)}</div>`
    : "";

  // Layout-specific content arrangement
  let contentHTML: string;
  let justifyContent = "center";

  if (layout === "end_card") {
    justifyContent = "center";
    contentHTML = `
      ${titleHTML}
      ${bodyHTML}
      <div class="cta">
        <div class="cta-button">SUBSCRIBE</div>
      </div>
      ${footerHTML}
    `;
  } else if (layout === "list_card" || layout === "checklist" || layout === "reveal_list") {
    justifyContent = "center";
    contentHTML = `${titleHTML}${bodyHTML}${bulletsHTML}`;
  } else {
    // title_card default
    justifyContent = "center";
    contentHTML = `${titleHTML}${bodyHTML}${bulletsHTML}`;
  }

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    width: ${width}px;
    height: ${height}px;
    background: linear-gradient(160deg, ${bg} 0%, ${bgLight} 50%, ${bg} 100%);
    color: ${text};
    font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
    font-size: ${baseFontSize}px;
    overflow: hidden;
    position: relative;
  }

  /* Subtle noise overlay */
  body::before {
    content: '';
    position: absolute;
    inset: 0;
    background: radial-gradient(circle at 20% 80%, ${accent}08 0%, transparent 50%),
                radial-gradient(circle at 80% 20%, ${accent}05 0%, transparent 50%);
    pointer-events: none;
  }

  /* Accent bar on the left */
  .accent-bar {
    position: absolute;
    left: 0;
    top: 10%;
    bottom: 10%;
    width: 5px;
    background: linear-gradient(to bottom, transparent, ${accent}, transparent);
    border-radius: 0 3px 3px 0;
  }

  /* Content container */
  .container {
    position: absolute;
    inset: 0;
    padding: 7% 8% 7% 9%;
    display: flex;
    flex-direction: column;
    justify-content: ${justifyContent};
    gap: ${Math.round(baseFontSize * 0.6)}px;
  }

  .title {
    font-size: ${Math.round(baseFontSize * 1.5)}px;
    font-weight: 700;
    color: ${accent};
    text-transform: uppercase;
    letter-spacing: 0.06em;
    line-height: 1.2;
    text-shadow: 0 2px 20px ${accent}30;
  }

  .body {
    font-size: ${baseFontSize}px;
    font-weight: 400;
    color: ${text};
    line-height: 1.55;
    opacity: 0.9;
    max-width: 85%;
  }

  .bullets {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: ${Math.round(baseFontSize * 0.5)}px;
    margin-top: ${Math.round(baseFontSize * 0.3)}px;
  }

  .bullets li {
    font-size: ${Math.round(baseFontSize * 0.85)}px;
    font-weight: 400;
    color: ${text};
    line-height: 1.45;
    padding-left: ${Math.round(baseFontSize * 1.2)}px;
    position: relative;
    opacity: 0.92;
  }

  .bullets li::before {
    content: '';
    position: absolute;
    left: ${Math.round(baseFontSize * 0.2)}px;
    top: ${Math.round(baseFontSize * 0.28)}px;
    width: ${Math.round(baseFontSize * 0.22)}px;
    height: ${Math.round(baseFontSize * 0.22)}px;
    background: ${accent};
    border-radius: 50%;
    box-shadow: 0 0 8px ${accent}60;
  }

  .footer {
    font-size: ${Math.round(baseFontSize * 0.6)}px;
    color: ${text};
    opacity: 0.5;
    margin-top: auto;
    letter-spacing: 0.03em;
  }

  /* End card specific */
  .cta {
    display: flex;
    justify-content: flex-start;
    margin-top: ${Math.round(baseFontSize * 0.5)}px;
  }

  .cta-button {
    display: inline-block;
    padding: ${Math.round(baseFontSize * 0.3)}px ${Math.round(baseFontSize * 1.2)}px;
    background: ${accent};
    color: #fff;
    font-size: ${Math.round(baseFontSize * 0.7)}px;
    font-weight: 700;
    letter-spacing: 0.1em;
    border-radius: ${Math.round(baseFontSize * 0.15)}px;
    box-shadow: 0 4px 20px ${accent}40;
  }

  /* Subtle bottom border glow */
  body::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 10%;
    right: 10%;
    height: 1px;
    background: linear-gradient(to right, transparent, ${accent}30, transparent);
  }
</style>
</head>
<body>
  <div class="accent-bar"></div>
  <div class="container">
    ${contentHTML}
  </div>
</body>
</html>`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Render a motion graphic card as a PNG file using Puppeteer.
 */
export async function renderMotionGraphic(
  spec: MotionGraphicSpec,
  outputPath: string
): Promise<void> {
  const width = spec.width || 1920;
  const height = spec.height || 1080;

  // Detect layout from spec content
  let layout = "title_card";
  if (spec.footer && !spec.title && !spec.body) layout = "end_card";
  else if (spec.bullets?.length) layout = "list_card";

  const html = buildHTML(spec, layout);
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.screenshot({ path: outputPath, type: "png", fullPage: false });
  } finally {
    await page.close();
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

  const layoutMatch = specString.match(/layout=(\w+)/);

  const textMatch = specString.match(/\btext="([^"]+)"/);
  if (textMatch) {
    const parts = textMatch[1].split(" / ");
    spec.title = parts[0].trim();
    if (parts[1]) spec.body = parts[1].trim();
  }

  const titleMatch = specString.match(/\btitle="([^"]+)"/);
  if (titleMatch) spec.title = titleMatch[1];

  const itemsMatch = specString.match(/\bitems="([^"]+)"/);
  if (itemsMatch) {
    spec.bullets = itemsMatch[1].split("|").map((s) => s.trim()).filter(Boolean);
  }

  const accentMatch = specString.match(/accent\s+\w+\s+(#[0-9a-fA-F]{6})/i);
  if (accentMatch) spec.accentColor = accentMatch[1];

  const bgMatch = specString.match(/near-black\s+(#[0-9a-fA-F]{6})/i);
  if (bgMatch) spec.backgroundColor = bgMatch[1];

  const layout = layoutMatch?.[1] || "title_card";
  if (layout === "end_card" && spec.title) {
    spec.footer = spec.title;
    spec.title = undefined;
    spec.body = undefined;
  }

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
