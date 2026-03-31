/**
 * Extract pure narration text from a script for TTS / voiceover generation.
 *
 * Uses a 6-pass ordered algorithm that EXTRACTS only narration blocks rather
 * than stripping bad content — far more robust against format variations.
 *
 * Gold standard script format (Step 8 output):
 *   EDITORIAL LOG / preamble
 *   ...
 *   FINAL POLISHED SCRIPT        ← Pass 1 slices here
 *   ...
 *   [SCENE N — TITLE]
 *   NARRATION (V.O.):            ← Pass 3 extracts between here...
 *   Actual narration text
 *   [DALLE: ...]                 ← ...and here
 *   ...
 *   WORD COUNT VERIFICATION      ← Pass 2 slices before here
 *
 * Used by BOTH prepare/route.ts AND executors.ts to ensure consistent output.
 */
export function extractNarration(script: string): string {
  let text = script;

  // ── Pass 1: Slice to "FINAL POLISHED SCRIPT" ────────────────────────────
  // Everything before this marker is editorial notes / compliance logs.
  const finalScriptIdx = text.indexOf("FINAL POLISHED SCRIPT");
  if (finalScriptIdx !== -1) {
    text = text.slice(finalScriptIdx);
  }

  // ── Pass 2: Slice before footer/end-of-narration markers ────────────────
  // These sections always appear after the last narration block.
  const endMarkers = [
    "WORD COUNT VERIFICATION",
    "PRODUCTION NOTES",
    "DELIVERY NOTES",
    "RUNWAY SCENE COUNT",
    "EDITORIAL LOG",
  ];
  for (const marker of endMarkers) {
    const idx = text.indexOf(marker);
    if (idx !== -1) {
      text = text.slice(0, idx);
    }
  }

  // ── Pass 3: Extract only NARRATION (V.O.) blocks ────────────────────────
  // Each scene's narration sits between "NARRATION (V.O.):" and the next
  // visual tag "[" or an ACT separator line.
  const narrationBlocks: string[] = [];
  const narrationRegex =
    /NARRATION \(V\.O\.\):\s*\n([\s\S]*?)(?=\[|(?:\n\n+[A-Z][─\u2500]{3,}|\n\n+ACT )|$)/g;
  let match: RegExpExecArray | null;
  while ((match = narrationRegex.exec(text)) !== null) {
    const block = match[1].trim();
    if (block) narrationBlocks.push(block);
  }

  // If Pass 3 found narration blocks, use only those.
  // Fall back to the full (Pass 1+2 trimmed) text for older script formats
  // that lack "NARRATION (V.O.):" prefixes.
  if (narrationBlocks.length > 0) {
    text = narrationBlocks.join("\n\n");
  }

  // ── Pass 4: Strip remaining structural markers ───────────────────────────
  text = text
    .replace(/\[SCENE \d+[^\]]*\]/g, "")
    .replace(/ACT [A-Z]+:[^\n]*/g, "")
    .replace(/EMOTIONAL ARC:[^\n]*/g, "")
    .replace(/[\u2500─]{3,}/g, "")
    .replace(/^FINAL POLISHED SCRIPT.*$/m, "")
    .replace(/^Production-ready.*$/m, "");

  // ── Pass 5: Strip visual direction tags (s flag for multiline) ───────────
  text = text.replace(
    /\[(?:DALLE|RUNWAY|STOCK|MOTION_GRAPHIC|DELIVERY)[^\]]*\]/g,
    ""
  );

  // ── Pass 6: Normalize whitespace ─────────────────────────────────────────
  text = text.replace(/\n{3,}/g, "\n\n").trim();

  return text;
}
