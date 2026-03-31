/**
 * Shared parser for extracting scenes from visual direction output.
 * Consolidates the JSON extraction logic used in prepare/route.ts, executors.ts.
 *
 * Visual direction output format:
 *   Section 1-3: cinematographer doc (free prose)
 *   === VISUAL DIRECTION JSON ===
 *   Section 4: JSON array of scene objects
 */

import type { SceneImage, SceneVideo } from "@/types";

const JSON_SEPARATOR = "=== VISUAL DIRECTION JSON ===";

/** Extract the raw scene array from visual direction output (shared logic). */
function extractSceneArray(visualsRaw: string): Record<string, unknown>[] {
  if (!visualsRaw) return [];

  const sepIdx = visualsRaw.indexOf(JSON_SEPARATOR);
  let jsonSource = sepIdx !== -1
    ? visualsRaw.slice(sepIdx + JSON_SEPARATOR.length).trim()
    : visualsRaw.trim();

  if (jsonSource.startsWith("```")) {
    jsonSource = jsonSource.replace(/^```(?:json|JSON)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }

  const jsonMatch = jsonSource.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  let parsed: unknown = JSON.parse(jsonMatch[0]);

  if (!Array.isArray(parsed) && typeof parsed === "object" && parsed !== null) {
    for (const k of ["scenes", "data", "entries"]) {
      const val = (parsed as Record<string, unknown>)[k];
      if (Array.isArray(val)) { parsed = val; break; }
    }
  }

  return Array.isArray(parsed) ? parsed as Record<string, unknown>[] : [];
}

/**
 * Parse visual direction output and return all DALL-E scenes with metadata.
 * Handles both gold standard (tag/dalle_prompt) and legacy (tag_type/prompt) formats.
 */
export function parseDalleScenes(visualsRaw: string): SceneImage[] {
  try {
    const scenes = extractSceneArray(visualsRaw);
    return scenes
      .filter((s) =>
        (s.tag === "DALLE" && typeof s.dalle_prompt === "string") ||
        (s.tag_type === "DALLE" && typeof s.prompt === "string") ||
        (typeof s.dalle_prompt === "string" && !s.tag && !s.tag_type)
      )
      .map((s): SceneImage => ({
        scene_id: typeof s.scene_id === "number" ? s.scene_id : 0,
        label: (s.label as string) || "",
        prompt: ((s.dalle_prompt ?? s.prompt) as string) || "",
        image_url: null,
        revised_prompt: null,
        status: "pending",
        ken_burns: (s.ken_burns as string) || undefined,
      }));
  } catch {
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

export interface MotionGraphicScene {
  scene_id: number;
  label: string;
  tag: string;
  motion_graphic_spec: string;
}

/**
 * Parse visual direction output and return all MOTION_GRAPHIC scenes.
 * Handles both gold standard (tag) and legacy (tag_type) formats.
 */
export function parseMotionGraphicScenes(visualsRaw: string): MotionGraphicScene[] {
  try {
    const scenes = extractSceneArray(visualsRaw);
    return scenes
      .filter((s) => String(s.tag || s.tag_type || "").toUpperCase() === "MOTION_GRAPHIC")
      .map((s): MotionGraphicScene => ({
        scene_id: typeof s.scene_id === "number" ? s.scene_id : 0,
        label: (s.label as string) || "",
        tag: "MOTION_GRAPHIC",
        motion_graphic_spec: (s.motion_graphic_spec as string) || (s.text_content as string) || "",
      }));
  } catch {
    return [];
  }
}

/**
 * Parse visual direction output and return all Runway scenes with metadata.
 * Handles both gold standard (tag/runway_prompt) and legacy (tag_type/prompt) formats.
 */
export function parseRunwayScenes(visualsRaw: string): SceneVideo[] {
  try {
    const scenes = extractSceneArray(visualsRaw);
    return scenes
      .filter((s) =>
        (s.tag === "RUNWAY" && typeof s.runway_prompt === "string") ||
        (s.tag_type === "RUNWAY" && (typeof s.prompt === "string" || typeof s.runway_prompt === "string"))
      )
      .map((s): SceneVideo => ({
        scene_id: typeof s.scene_id === "number" ? s.scene_id : 0,
        label: (s.label as string) || "",
        prompt: ((s.runway_prompt ?? s.prompt) as string) || "",
        video_url: null,
        task_id: null,
        status: "pending",
        motion_type: (s.motion_type as string) || undefined,
      }));
  } catch {
    const matches = visualsRaw.match(/"runway_prompt"\s*:\s*"((?:[^"\\]|\\.)*)"/g);
    if (!matches) return [];
    return matches.map((m, i) => ({
      scene_id: i + 1,
      label: "",
      prompt: m.replace(/^"runway_prompt"\s*:\s*"/, "").replace(/"$/, ""),
      video_url: null,
      task_id: null,
      status: "pending" as const,
    }));
  }
}
