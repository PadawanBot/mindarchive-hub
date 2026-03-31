/**
 * Extract pure narration text from a script for TTS / voiceover generation.
 *
 * Three strategies tried in order:
 *
 * 1. GOLD STANDARD — Script has both "FINAL POLISHED SCRIPT" header AND
 *    "NARRATION (V.O.):" blocks. Slice to the header, cut footers, extract blocks.
 *
 * 2. NARRATION BLOCKS — Script has "NARRATION (V.O.):" blocks but no gold
 *    standard wrapper (e.g. KMP Anime format). Extract blocks from full text.
 *
 * 3. FALLBACK STRIP — No NARRATION (V.O.) blocks at all (markdown, older formats).
 *    Strip known non-narration patterns from the full original text.
 *
 * Critical: end-marker cuts (PRODUCTION NOTES, etc.) only apply in Strategy 1
 * because those markers only reliably appear as footers in the gold standard format.
 * In other formats they can appear mid-script, which would destroy the content.
 */
export function extractNarration(script: string): string {
  // Helper: extract NARRATION (V.O.) blocks from a text chunk
  function extractBlocks(text: string): string[] {
    const blocks: string[] = [];
    const re =
      /NARRATION \(V\.O\.\):\s*\n([\s\S]*?)(?=\[|(?:\n\n+[A-Z][─\u2500]{3,}|\n\n+ACT )|$)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const block = m[1].trim();
      if (block) blocks.push(block);
    }
    return blocks;
  }

  function cleanBlocks(blocks: string[]): string {
    let result = blocks.join("\n\n");
    // Strip any visual tags that leaked into narration blocks
    result = result.replace(
      /\[(?:DALLE|RUNWAY|STOCK|MOTION_GRAPHIC|VISUAL CUE|DELIVERY)[:\s][^\]]*\]/gi,
      ""
    );
    return result.replace(/\n{3,}/g, "\n\n").trim();
  }

  // ── Strategy 1: Gold standard format ─────────────────────────────────────
  // Only when "FINAL POLISHED SCRIPT" is present — that marker guarantees
  // the footer markers (PRODUCTION NOTES, etc.) are safe to cut at.
  if (script.includes("FINAL POLISHED SCRIPT")) {
    let text = script.slice(script.indexOf("FINAL POLISHED SCRIPT"));

    const endMarkers = [
      "WORD COUNT VERIFICATION",
      "PRODUCTION NOTES",
      "DELIVERY NOTES",
      "RUNWAY SCENE COUNT",
      "EDITORIAL LOG",
    ];
    for (const marker of endMarkers) {
      const idx = text.indexOf(marker);
      if (idx !== -1) text = text.slice(0, idx);
    }

    const blocks = extractBlocks(text);
    if (blocks.length > 0) return cleanBlocks(blocks);
  }

  // ── Strategy 2: NARRATION (V.O.) blocks without gold standard wrapper ────
  // Search the full original text. Strip bold/italic markdown first so that
  // "**NARRATION (V.O.):**" (common in markdown-format scripts) is matched.
  {
    const scriptNoBold = script
      .replace(/\*\*([^*\n]+)\*\*/g, "$1")
      .replace(/\*([^*\n]+)\*/g, "$1");
    const blocks = extractBlocks(scriptNoBold);
    if (blocks.length > 0) return cleanBlocks(blocks);
  }

  // ── Strategy 3: Fallback strip ────────────────────────────────────────────
  // No NARRATION (V.O.) blocks found. Strip known non-narration patterns
  // from the full original text. Minimal stripping only.
  let text = script;

  // Remove WORD COUNT VERIFICATION footer and everything after
  text = text.replace(/\n*WORD COUNT VERIFICATION[\s\S]*/i, "");

  // Remove visual direction tags
  text = text.replace(
    /\[(?:DALLE|RUNWAY|STOCK|MOTION_GRAPHIC|VISUAL CUE|DELIVERY)[:\s][^\]]*\]/gi,
    ""
  );

  // Remove structural labels
  text = text
    .replace(/^NARRATION\s*\(V\.O\.\)\s*:?\s*/gim, "")
    .replace(/^\[SCENE \d+[^\]]*\]\s*$/gm, "")
    .replace(/^ACT (ONE|TWO|THREE)\s*:.*$/gim, "")
    .replace(/^EMOTIONAL ARC:[^\n]*/gim, "")
    .replace(/[─\u2500]{3,}/g, "")
    .replace(/^— END OF NARRATION —.*$/gim, "")
    .replace(/^STEP \d+\s*[—–-].*$/gm, "");

  // Remove markdown structure
  text = text
    .replace(/^#{1,6}\s.*$/gm, "")
    .replace(/^\|.*$/gm, "")
    .replace(/^---+$/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1");

  // Remove metadata header lines
  text = text.replace(
    /^(Topic|Channel|Runtime target|Word target|Format)\s*:.*$/gim,
    ""
  );

  return text.replace(/\n{3,}/g, "\n\n").trim();
}
