/**
 * Extract pure narration text from a script for TTS / voiceover generation.
 * Strips all visual tags, scene markers, act headers, production notes, and
 * formatting — leaving only the words that should be spoken aloud.
 *
 * Used by BOTH the prepare/route.ts worker routing path AND the executors.ts
 * fallback path, ensuring consistent output regardless of execution path.
 */
export function extractNarration(script: string): string {
  return script
    // ── Remove trailing metadata blocks ──────────────────────────────────
    // WORD COUNT VERIFICATION block and everything after it
    .replace(/\n*WORD COUNT VERIFICATION[\s\S]*/i, "")
    // PRODUCTION NOTES block — lookahead with fallback to end-of-string
    .replace(/PRODUCTION NOTES:?[\s\S]*?(?=\nVISUAL TAG BUDGET|\nACT ONE|\nACT TWO|\nACT THREE|\n\[SCENE|$)/i, "")
    // VISUAL TAG BUDGET block — lookahead with fallback to end-of-string
    .replace(/VISUAL TAG BUDGET:?[\s\S]*?(?=\nACT ONE|\nACT TWO|\nACT THREE|\n\[SCENE|$)/i, "")
    // Metadata header lines (Topic:, Channel:, Runtime:, Word target:, Format:)
    .replace(/^(Topic|Channel|Runtime target|Word target|Format)\s*:.*$/gim, "")

    // ── Remove visual tags (bracketed) ────────────────────────────────────
    // [DALLE: ...], [RUNWAY: ...], [STOCK: ...], [MOTION_GRAPHIC: ...], [VISUAL CUE: ...]
    .replace(/\[(DALLE|RUNWAY|STOCK|MOTION_GRAPHIC|VISUAL[\s_]CUE)[:\s][^\]]*\]/gi, "")
    // [DELIVERY: ...], [DELIVERY NOTE: ...], [NOTE: ...]
    .replace(/\[(DELIVERY NOTE?|NOTE)[:\s][^\]]*\]/gi, "")

    // ── Remove scene / act structure markers ─────────────────────────────
    // [SCENE N -- TITLE] or [SCENE HOOK -- TITLE] (digits OR word after SCENE)
    .replace(/^\[SCENE[^\]]*\]\s*$/gim, "")
    // ACT ONE: / ACT TWO: / ACT THREE: lines
    .replace(/^ACT (ONE|TWO|THREE)\s*:.*$/gim, "")
    // NARRATION (V.O.): prefix (with or without colon/space variants)
    .replace(/^NARRATION\s*\(V\.O\.\)\s*:?\s*/gim, "")
    // Standalone VISUAL CUE: lines (not bracketed)
    .replace(/^VISUAL CUE\s*:.*$/gim, "")
    // Standalone DELIVERY: or DELIVERY NOTE: lines
    .replace(/^DELIVERY( NOTE)?\s*:.*$/gim, "")

    // ── Remove markdown formatting ────────────────────────────────────────
    // Heading lines (## Section Title)
    .replace(/^#{1,3}\s.*$/gm, "")
    // Horizontal rules
    .replace(/^---+$/gm, "")
    // Bold / italic markers (keep the text, drop the asterisks)
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")

    // ── Normalise whitespace ──────────────────────────────────────────────
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
