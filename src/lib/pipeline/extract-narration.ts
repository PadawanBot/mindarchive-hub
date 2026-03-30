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
    // PRODUCTION NOTES block (up to next section)
    .replace(/PRODUCTION NOTES[\s\S]*?(?=\nVISUAL TAG BUDGET|\nACT ONE|\n\[SCENE)/i, "")
    // VISUAL TAG BUDGET block (up to next section)
    .replace(/VISUAL TAG BUDGET[\s\S]*?(?=\nACT ONE|\n\[SCENE)/i, "")
    // Metadata header lines (Topic:, Channel:, Runtime:, Word target:, Format:)
    .replace(/^(Topic|Channel|Runtime target|Word target|Format)\s*:.*$/gim, "")

    // ── Remove visual tags ────────────────────────────────────────────────
    // Inline bracketed tags: [DALLE: ...], [RUNWAY: ...], [STOCK: ...], [MOTION_GRAPHIC: ...], [VISUAL CUE: ...]
    // Handle both single-line and (rare) multi-line tag content
    .replace(/\[(DALLE|RUNWAY|STOCK|MOTION_GRAPHIC|VISUAL[\s_]CUE)[:\s][^\]]*\]/gi, "")

    // ── Remove scene / act structure markers ─────────────────────────────
    // [SCENE N -- DESCRIPTIVE TITLE] on its own line
    .replace(/^\[SCENE\s+\d+[^\]]*\]\s*$/gim, "")
    // ACT ONE: / ACT TWO: / ACT THREE: lines
    .replace(/^ACT (ONE|TWO|THREE)\s*:.*$/gim, "")
    // NARRATION (V.O.): prefix
    .replace(/^NARRATION\s*\(V\.O\.\)\s*:?\s*/gim, "")

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
