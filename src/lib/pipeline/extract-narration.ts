/**
 * Extract pure narration text from a script for TTS / voiceover generation.
 *
 * Two extraction strategies:
 *
 * 1. GOLD STANDARD — For scripts with "NARRATION (V.O.):" blocks (Step 8 output):
 *    Passes 1-3 positively extract only narration blocks. Most precise.
 *
 * 2. FALLBACK STRIP — For any other script format (markdown, older prompts, etc.):
 *    Removes known non-narration content (visual tags, metadata, scene markers).
 *    This is the original approach that was working across all video productions.
 *
 * Used by BOTH prepare/route.ts AND executors.ts to ensure consistent output.
 */
export function extractNarration(script: string): string {
  let text = script;

  // ── Pass 1: Slice to "FINAL POLISHED SCRIPT" (skip editorial logs) ─────
  const finalScriptIdx = text.indexOf("FINAL POLISHED SCRIPT");
  if (finalScriptIdx !== -1) {
    text = text.slice(finalScriptIdx);
  }

  // ── Pass 2: Slice before footer markers ────────────────────────────────
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

  // ── Pass 3: Try to extract NARRATION (V.O.) blocks ────────────────────
  const narrationBlocks: string[] = [];
  const narrationRegex =
    /NARRATION \(V\.O\.\):\s*\n([\s\S]*?)(?=\[|(?:\n\n+[A-Z][─\u2500]{3,}|\n\n+ACT )|$)/g;
  let match: RegExpExecArray | null;
  while ((match = narrationRegex.exec(text)) !== null) {
    const block = match[1].trim();
    if (block) narrationBlocks.push(block);
  }

  if (narrationBlocks.length > 0) {
    // ─── Gold standard path: use extracted blocks ───────────────────────
    text = narrationBlocks.join("\n\n");
  } else {
    // ─── Fallback strip path: original working approach ─────────────────
    // This handles markdown scripts, older formats, and any script that
    // doesn't use "NARRATION (V.O.):" prefixes. Proven working across
    // all previous video productions (pre-commit 1abe084).
    text = text
      // Remove metadata header lines
      .replace(/^(Topic|Channel|Runtime target|Word target|Format)\s*:.*$/gim, "")
      // Remove markdown headers
      .replace(/^#{1,3}\s.*$/gm, "")
      // Remove markdown tables (lines starting with |)
      .replace(/^\|.*$/gm, "")
      // Remove markdown horizontal rules
      .replace(/^---+$/gm, "")
      // Remove bold/italic markdown
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1");
  }

  // ── Pass 4: Strip structural markers (both paths) ──────────────────────
  text = text
    .replace(/\[SCENE \d+[^\]]*\]/g, "")
    .replace(/ACT [A-Z]+:[^\n]*/g, "")
    .replace(/EMOTIONAL ARC:[^\n]*/g, "")
    .replace(/[─\u2500]{3,}/g, "")
    .replace(/^FINAL POLISHED SCRIPT.*$/m, "")
    .replace(/^Production-ready.*$/m, "")
    .replace(/^NARRATION\s*\(V\.O\.\)\s*:?\s*/gim, "");

  // ── Pass 5: Strip visual direction tags ─────────────────────────────────
  text = text.replace(
    /\[(?:DALLE|RUNWAY|STOCK|MOTION_GRAPHIC|VISUAL CUE|DELIVERY)[:\s][^\]]*\]/gi,
    ""
  );

  // ── Pass 6: Normalize whitespace ─────────────────────────────────────────
  text = text.replace(/\n{3,}/g, "\n\n").trim();

  return text;
}
