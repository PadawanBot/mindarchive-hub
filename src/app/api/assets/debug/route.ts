/**
 * GET /api/assets/debug?project_id=... — Debug endpoint showing what the backfill would find.
 * Temporary — remove after asset system is working.
 */
import { NextResponse } from "next/server";
import { getSlotsForStep } from "@/lib/asset-validation";
import { parseSlotKey, getNestedValue } from "@/lib/asset-patch";
import { getStepsByProject } from "@/lib/store";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("project_id");
  if (!projectId) return NextResponse.json({ error: "project_id required" }, { status: 400 });

  const steps = await getStepsByProject(projectId);

  const debug: Record<string, unknown> = {};

  for (const step of steps) {
    const output = step.output as Record<string, unknown> | undefined;
    const slots = getSlotsForStep(step.step);

    const slotResults: Record<string, unknown> = {};
    for (const slot of slots) {
      const path = parseSlotKey(slot.slotKey);
      const val = getNestedValue(output || {}, path);
      slotResults[slot.slotKey] = {
        path,
        value: typeof val === "string" ? val.slice(0, 80) + "..." : val,
        found: val != null,
      };
    }

    // Also check direct known fields
    const directChecks: Record<string, unknown> = {};
    if (step.step === "voiceover_generation") {
      directChecks["output.audio_url"] = typeof output?.audio_url === "string"
        ? (output.audio_url as string).slice(0, 80) + "..."
        : output?.audio_url;
      directChecks["output_keys"] = output ? Object.keys(output) : "no output";
    }
    if (step.step === "image_generation") {
      directChecks["output.images"] = Array.isArray(output?.images)
        ? `array of ${(output.images as unknown[]).length}`
        : typeof output?.images;
      if (Array.isArray(output?.images)) {
        directChecks["images[0]_keys"] = Object.keys((output.images as Record<string, unknown>[])[0] || {});
      }
    }
    if (step.step === "hero_scenes") {
      directChecks["output.scenes"] = Array.isArray(output?.scenes)
        ? `array of ${(output.scenes as unknown[]).length}`
        : typeof output?.scenes;
      if (Array.isArray(output?.scenes)) {
        const s0 = (output.scenes as Record<string, unknown>[])[0];
        directChecks["scenes[0]_keys"] = s0 ? Object.keys(s0) : "empty";
        directChecks["scenes[0].video_url"] = typeof s0?.video_url === "string"
          ? (s0.video_url as string).slice(0, 80) + "..."
          : s0?.video_url;
      }
    }
    if (step.step === "stock_footage") {
      directChecks["output.footage"] = Array.isArray(output?.footage)
        ? `array of ${(output.footage as unknown[]).length}`
        : typeof output?.footage;
      directChecks["output_keys"] = output ? Object.keys(output) : "no output";
    }

    debug[step.step] = {
      status: step.status,
      has_output: !!output,
      output_keys: output ? Object.keys(output) : [],
      slot_results: slotResults,
      direct_checks: directChecks,
    };
  }

  return NextResponse.json({ debug });
}
