/**
 * Shared parser for extracting DALL-E scenes from visual direction output.
 * Consolidates the JSON extraction logic used in prepare/route.ts, executors.ts.
 *
 * Visual direction output format:
 *   Section 1-3: cinematographer doc (free prose)
 *   === VISUAL DIRECTION JSON ===
 *   Section 4: JSON array of scene objects
 */

import type { SceneImage } from "@/types";

const JSON_SEPARATOR = "=== VISUAL DIRECTION JSON ===";

/**
 * Parse visual direction output and return all DALL-E scenes with metadata.
 * Handles both gold standard (tag/dalle_prompt) and legacy (tag_type/prompt) formats.
 */
export function parseDalleScenes(visualsRaw: string): SceneImage[] {
  if (!visualsRaw) return [];

  // Split on separator if present
  const sepIdx = visualsRaw.indexOf(JSON_SEPARATOR);
  let jsonSource = sepIdx !== -1
    ? visualsRaw.slice(sepIdx + JSON_SEPARATOR.length).trim()
    : visualsRaw.trim();

  // Strip markdown code fences
  if (jsonSource.startsWith("```")) {
    jsonSource = jsonSource.replace(/^```(?:json|JSON)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }

  try {
    // Extract JSON array via regex (handles trailing text after the array)
    const jsonMatch = jsonSource.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    let parsed: unknown = JSON.parse(jsonMatch[0]);

    // Handle wrapped objects like { scenes: [...] }
    if (!Array.isArray(parsed) && typeof parsed === "object" && parsed !== null) {
      for (const k of ["scenes", "data", "entries"]) {
        const val = (parsed as Record<string, unknown>)[k];
        if (Array.isArray(val)) { parsed = val; break; }
      }
    }

    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((s: Record<string, unknown>) =>
        // Gold standard: tag === "DALLE" with dalle_prompt
        (s.tag === "DALLE" && typeof s.dalle_prompt === "string") ||
        // Legacy: tag_type === "DALLE" with prompt
        (s.tag_type === "DALLE" && typeof s.prompt === "string") ||
        // Legacy: bare dalle_prompt field
        (typeof s.dalle_prompt === "string" && !s.tag && !s.tag_type)
      )
      .map((s: Record<string, unknown>): SceneImage => ({
        scene_id: typeof s.scene_id === "number" ? s.scene_id : 0,
        label: (s.label as string) || "",
        prompt: ((s.dalle_prompt ?? s.prompt) as string) || "",
        image_url: null,
        revised_prompt: null,
        status: "pending",
        ken_burns: (s.ken_burns as string) || undefined,
      }));
  } catch {
    // Fallback: extract dalle_prompt values with regex
    const matches = visualsRaw.match(/"dalle_prompt"\s*:\s*"((?:[^"\\]|\\.)*)"/g);
    if (!matches) return [];
    return matches.map((m, i) => ({
      scene_id: i + 1,
      label: "",
      prompt: m.replace(/^"dalle_prompt"\s*:\s*"/, "").replace(/"$/, ""),
      image_url: null,
      revised_prompt: null,
      status: "pending" as const,
    }));
  }
}
