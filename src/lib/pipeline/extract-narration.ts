/**
 * Extract pure narration text from a script for TTS / voiceover generation.
 *
 * Two extraction strategies tried in order:
 *
 * 1. GOLD STANDARD — Scripts with "NARRATION (V.O.):" blocks (Step 8 format):
 *    Slices to "FINAL POLISHED SCRIPT", cuts footer markers, extracts blocks.
 *    Most precise — discards all non-narration content by construction.
 *
 * 2. FALLBACK STRIP — Any other format (markdown, older prompts, etc.):
 *    Strips known non-narration patterns from the FULL original text.
 *    Minimal stripping only — avoids greedy cuts that wipe content when
 *    section markers appear mid-script rather than as footers.
 *
 * Used by BOTH prepare/route.ts AND executors.ts to ensure consistent output.
 */
export function extractNarration(script: string): string {
  // ── Strategy 1: Gold standard NARRATION (V.O.) block extraction ──────────
  // Only applies when the script uses the gold standard Step 8 format.
  {
    let text = script;

    // Slice to "FINAL POLISHED SCRIPT" — skip editorial log
    const finalScriptIdx = text.indexOf("FINAL POLISHED SCRIPT");
    if (finalScriptIdx !== -1) {
      text = text.slice(finalScriptIdx);
    }

    // Slice before footer markers (only safe because these are always footers
    // in the gold standard format, never mid-script)
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

    // Extract NARRATION (V.O.) blocks
    const narrationBlocks: string[] = [];
    const narrationRegex =
      /NARRATION \(V\.O\.\):\s*\n([\s\S]*?)(?=\[|(?:\n\n+[A-Z][─\u2500]{3,}|\n\n+ACT )|$)/g;
    let match: RegExpExecArray | null;
    while ((match = narrationRegex.exec(text)) !== null) {
      const block = match[1].trim();
      if (block) narrationBlocks.push(block);
    }

    if (narrationBlocks.length > 0) {
      // Found blocks — strip any stray visual tags and return
      let result = narrationBlocks.join("\n\n");
      result = result.replace(
        /\[(?:DALLE|RUNWAY|STOCK|MOTION_GRAPHIC|VISUAL CUE|DELIVERY)[:\s][^\]]*\]/gi,
        ""
      );
      return result.replace(/\n{3,}/g, "\n\n").trim();
    }
  }

  // ── Strategy 2: Fallback strip — applied to the FULL original text ────────
  // Used when the script has no NARRATION (V.O.) blocks (markdown format, etc.).
  // Only strip things we're certain are never narration:
  //   - Visual direction tags [DALLE: ...], [RUNWAY: ...], etc.
  //   - Markdown structure (headers, tables, bold/italic, HRs)
  //   - WORD COUNT VERIFICATION footer (always at the very end)
  //   - NARRATION (V.O.): labels (the label itself, not the content)
  //   - Scene/act structural labels
  // Do NOT aggressively cut at PRODUCTION NOTES — it can appear mid-script.
  let text = script;

  // Remove WORD COUNT VERIFICATION footer and everything after it
  // (This is the only footer safe to cut greedy — it's always last)
  text = text.replace(/\n*WORD COUNT VERIFICATION[\s\S]*/i, "");

  // Remove visual direction tags
  text = text.replace(
    /\[(?:DALLE|RUNWAY|STOCK|MOTION_GRAPHIC|VISUAL CUE|DELIVERY)[:\s][^\]]*\]/gi,
    ""
  );

  // Remove structural labels (not their content)
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
    .replace(/^\|.*$/gm, "")             // table rows
    .replace(/^---+$/gm, "")             // HR
    .replace(/\*\*([^*]+)\*\*/g, "$1")   // bold
    .replace(/\*([^*]+)\*/g, "$1");      // italic

  // Remove metadata header lines (key: value pairs at the top)
  text = text.replace(
    /^(Topic|Channel|Runtime target|Word target|Format)\s*:.*$/gim,
    ""
  );

  // Normalize whitespace
  return text.replace(/\n{3,}/g, "\n\n").trim();
}
