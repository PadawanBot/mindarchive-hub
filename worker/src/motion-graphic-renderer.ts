import sharp from "sharp";

/**
 * Safe margins — 7% from each edge for landscape + portrait safety.
 * Text placed within these margins is visible on all devices/crops.
 */
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
}

interface RenderOptions {
  width: number;
  height: number;
}

/**
 * Render a motion graphic card as a PNG buffer.
 * Uses safe margins (7% from each edge) to ensure text is visible
 * in both landscape (16:9) and portrait (9:16) crops.
 */
export async function renderMotionGraphic(
  spec: MotionGraphicSpec,
  options: RenderOptions = { width: 1920, height: 1080 }
): Promise<Buffer> {
  const { width, height } = options;
  const marginX = Math.round(width * MARGIN_X_PERCENT);
  const marginY = Math.round(height * MARGIN_Y_PERCENT);
  const contentWidth = width - marginX * 2;

  const bgColor = spec.backgroundColor || "#1a1a2e";
  const textColor = spec.textColor || "#ffffff";
  const accentColor = spec.accentColor || "#e94560";
  const baseFontSize = spec.fontSize || 48;

  // Build SVG text card
  const lines: string[] = [];
  let y = marginY + baseFontSize;

  // Title
  if (spec.title) {
    lines.push(
      `<text x="${marginX}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="${baseFontSize * 1.4}" font-weight="bold" fill="${accentColor}">${escapeXml(spec.title)}</text>`
    );
    y += baseFontSize * 1.8;
  }

  // Divider line after title
  if (spec.title && (spec.body || spec.bullets?.length)) {
    lines.push(
      `<line x1="${marginX}" y1="${y - baseFontSize * 0.4}" x2="${marginX + contentWidth * 0.3}" y2="${y - baseFontSize * 0.4}" stroke="${accentColor}" stroke-width="3" />`
    );
    y += baseFontSize * 0.5;
  }

  // Body text — wrap lines
  if (spec.body) {
    const wrapped = wrapText(spec.body, Math.floor(contentWidth / (baseFontSize * 0.5)));
    for (const line of wrapped) {
      lines.push(
        `<text x="${marginX}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="${baseFontSize}" fill="${textColor}">${escapeXml(line)}</text>`
      );
      y += baseFontSize * 1.4;
    }
    y += baseFontSize * 0.3;
  }

  // Bullet points
  if (spec.bullets?.length) {
    for (const bullet of spec.bullets) {
      const bulletX = marginX + baseFontSize * 0.5;
      // Bullet dot
      lines.push(
        `<circle cx="${marginX + baseFontSize * 0.2}" cy="${y - baseFontSize * 0.3}" r="${baseFontSize * 0.15}" fill="${accentColor}" />`
      );
      const wrapped = wrapText(bullet, Math.floor((contentWidth - baseFontSize) / (baseFontSize * 0.5)));
      for (const line of wrapped) {
        lines.push(
          `<text x="${bulletX}" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="${baseFontSize * 0.9}" fill="${textColor}">${escapeXml(line)}</text>`
        );
        y += baseFontSize * 1.3;
      }
      y += baseFontSize * 0.2;
    }
  }

  // Footer
  if (spec.footer) {
    const footerY = height - marginY;
    lines.push(
      `<text x="${marginX}" y="${footerY}" font-family="Arial, Helvetica, sans-serif" font-size="${baseFontSize * 0.7}" fill="${textColor}" opacity="0.7">${escapeXml(spec.footer)}</text>`
    );
  }

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${width}" height="${height}" fill="${bgColor}" />
    ${lines.join("\n    ")}
  </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wrapText(text: string, maxCharsPerLine: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (current.length + word.length + 1 > maxCharsPerLine) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines;
}
