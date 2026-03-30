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
    // ── Remove footer blocks ──────────────────────────────────────────────
    // WORD COUNT VERIFICATION and everything after it
    .replace(/\n*WORD COUNT VERIFICATION[\s\S]*/i, "")

    // ── Remove preamble header blocks (bounded to next blank line) ────────
    // PRODUCTION NOTES: header + all consecutive non-blank lines after it
    .replace(/^PRODUCTION NOTES:?.*(\n(?!\n).+)*/gim, "")
    // VISUAL TAG BUDGET: header + all consecutive non-blank lines after it
    .replace(/^VISUAL TAG BUDGET:?.*(\n(?!\n).+)*/gim, "")
    // Metadata key:value lines (Topic:, Channel:, Runtime target:, etc.)
    .replace(/^(Topic|Channel|Runtime target|Word target|Format)\s*:.*$/gim, "")
    // Markdown table rows (| Field | Value |) — used for metadata headers
    .replace(/^\|.+\|.*$/gm, "")
    // Markdown table separator rows (|---|---|)
    .replace(/^\|[-| :]+\|.*$/gm, "")

    // ── Remove visual tags (bracketed) ────────────────────────────────────
    // [DALLE: ...], [RUNWAY: ...], [STOCK: ...], [MOTION_GRAPHIC: ...], [VISUAL CUE: ...]
    .replace(/\[(DALLE|RUNWAY|STOCK|MOTION_GRAPHIC|VISUAL[\s_]CUE)[:\s][^\]]*\]/gi, "")
    // [DELIVERY: ...], [DELIVERY NOTE: ...], [NOTE: ...]
    .replace(/\[(DELIVERY NOTE?|NOTE)[:\s][^\]]*\]/gi, "")

    // ── Remove scene / act structure markers ─────────────────────────────
    // [SCENE N -- TITLE] or [SCENE HOOK -- TITLE] on its own line
    .replace(/^\[SCENE[^\]]*\]\s*$/gim, "")
    // ACT ONE: / ACT TWO: / ACT THREE: lines
    .replace(/^ACT (ONE|TWO|THREE)\s*:.*$/gim, "")
    // NARRATION (V.O.): prefix
    .replace(/^NARRATION\s*\(V\.O\.\)\s*:?\s*/gim, "")
    // Standalone VISUAL CUE: lines (not bracketed)
    .replace(/^VISUAL CUE\s*:.*$/gim, "")
    // Standalone DELIVERY: lines
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
