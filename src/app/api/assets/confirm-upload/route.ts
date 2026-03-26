/**
 * POST /api/assets/confirm-upload — Confirm a direct-to-Supabase upload.
 * Called after client finishes uploading via signed URL.
 * Records the asset and patches the step output.
 */
import { NextResponse } from "next/server";
import { getAssetUrl } from "@/lib/storage";
import { getSlotDef } from "@/lib/asset-validation";
import { patchStepOutput } from "@/lib/asset-patch";
import { getStepsByProject, upsertStep } from "@/lib/store";
import { upsertAssetRecord } from "@/lib/asset-db";

export async function POST(request: Request) {
  try {
    const {
      project_id, step, slot_key, storage_path, filename,
      mime_type, size_bytes, width, height, duration_ms,
    } = await request.json();

    if (!project_id || !step || !slot_key || !storage_path) {
      return NextResponse.json(
        { success: false, error: "Missing required fields" },
        { status: 400 }
      );
    }

    const slotDef = getSlotDef(step, slot_key);
    if (!slotDef) {
      return NextResponse.json(
        { success: false, error: `Unknown slot: ${step}/${slot_key}` },
        { status: 400 }
      );
    }

    // Get the public URL
    const url = getAssetUrl(storage_path);
    if (!url) {
      return NextResponse.json(
        { success: false, error: "Could not resolve public URL for uploaded file" },
        { status: 500 }
      );
    }

    // Record in assets table
    await upsertAssetRecord({
      projectId: project_id,
      step,
      slotKey: slot_key,
      filename: filename || storage_path.split("/").pop() || "unknown",
      storagePath: storage_path,
      mimeType: mime_type || "application/octet-stream",
      sizeBytes: size_bytes || 0,
      url,
      source: "manual",
      width,
      height,
      durationMs: duration_ms,
    });

    // Patch step output
    const steps = await getStepsByProject(project_id);
    const existing = steps.find((s) => s.step === step);
    if (existing?.output) {
      const patchedOutput = patchStepOutput(
        existing.output as Record<string, unknown>,
        slot_key,
        url
      );
      await upsertStep(project_id, step, {
        output: patchedOutput,
        status: existing.status === "failed" ? "completed" : existing.status,
      } as Record<string, unknown>);
    }

    // Set modified_at
    await upsertStep(project_id, step, {
      modified_at: new Date().toISOString(),
    } as Record<string, unknown>);

    return NextResponse.json({
      success: true,
      data: { url, step, slot_key, storage_path },
    });
  } catch (error) {
    console.error("[assets/confirm-upload]", error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
