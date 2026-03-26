/**
 * JSONB output patching for manual asset management.
 * Translates slot keys like "images[2].url" into nested object mutations.
 */

/**
 * Parse a slot key into path segments.
 * "images[2].url" → ["images", 2, "url"]
 * "audio_url" → ["audio_url"]
 * "scenes[0].video_url" → ["scenes", 0, "video_url"]
 */
export function parseSlotKey(slotKey: string): (string | number)[] {
  const segments: (string | number)[] = [];
  const parts = slotKey.split(".");

  for (const part of parts) {
    const bracketMatch = part.match(/^([a-zA-Z_]+)\[(\d+)\]$/);
    if (bracketMatch) {
      segments.push(bracketMatch[1]);
      segments.push(parseInt(bracketMatch[2], 10));
    } else {
      segments.push(part);
    }
  }

  return segments;
}

/**
 * Get a value at a nested path in an object.
 */
export function getNestedValue(
  obj: Record<string, unknown>,
  path: (string | number)[]
): unknown {
  let current: unknown = obj;
  for (const segment of path) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string | number, unknown>)[segment];
  }
  return current;
}

/**
 * Set a value at a nested path, creating intermediate objects/arrays as needed.
 * Returns a new object (shallow clone at each level).
 */
export function setNestedValue(
  obj: Record<string, unknown>,
  path: (string | number)[],
  value: unknown
): Record<string, unknown> {
  if (path.length === 0) return obj;

  const result = { ...obj };
  let current: Record<string | number, unknown> = result;

  for (let i = 0; i < path.length - 1; i++) {
    const segment = path[i];
    const nextSegment = path[i + 1];
    const existing = current[segment];

    if (existing != null && typeof existing === "object") {
      // Clone to avoid mutating original
      current[segment] = Array.isArray(existing) ? [...existing] : { ...existing as Record<string, unknown> };
    } else {
      // Create new container based on next segment type
      current[segment] = typeof nextSegment === "number" ? [] : {};
    }
    current = current[segment] as Record<string | number, unknown>;
  }

  const lastSegment = path[path.length - 1];

  // If setting into an array, ensure it's long enough
  if (typeof lastSegment === "number" && Array.isArray(current)) {
    while (current.length <= lastSegment) {
      current.push({});
    }
  }

  current[lastSegment] = value;
  return result;
}

/**
 * Clear a value at a nested path (set to null).
 */
export function clearNestedValue(
  obj: Record<string, unknown>,
  path: (string | number)[]
): Record<string, unknown> {
  return setNestedValue(obj, path, null);
}

/**
 * Patch a step's output with a new asset URL at the given slot key.
 * Returns the patched output (new object, original not mutated).
 */
export function patchStepOutput(
  currentOutput: Record<string, unknown>,
  slotKey: string,
  newUrl: string | null
): Record<string, unknown> {
  const path = parseSlotKey(slotKey);

  if (newUrl === null) {
    return clearNestedValue(currentOutput, path);
  }

  // Set the URL
  let patched = setNestedValue(currentOutput, path, newUrl);

  // Also mark the containing object with source metadata
  // e.g. for "images[2].url", set "images[2].source" = "manual"
  if (path.length >= 2) {
    const sourcePath = [...path.slice(0, -1), "source"];
    patched = setNestedValue(patched, sourcePath, "manual");
  }

  return patched;
}
