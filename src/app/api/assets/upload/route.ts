/**
 * POST /api/assets/upload — Upload a file (<4MB) to a specific step/slot.
 * Validates the file, stores to Supabase, patches the step output.
 */
import { NextResponse } from "next/server";
import { uploadAsset } from "@/lib/storage";
import { getSlotDef, validateFile, storageFilename } from "@/lib/asset-validation";
import { patchStepOutput } from "@/lib/asset-patch";
import { getStepsByProject, upsertStep } from "@/lib/store";
import { upsertAssetRecord } from "@/lib/asset-db";

export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const projectId = formData.get("project_id") as string;
    const step = formData.get("step") as string;
    const slotKey = formData.get("slot_key") as string;

    // Optional client-side metadata
    const width = formData.get("width") ? parseInt(formData.get("width") as string) : undefined;
    const height = formData.get("height") ? parseInt(formData.get("height") as string) : undefined;
    const durationMs = formData.get("duration_ms") ? parseInt(formData.get("duration_ms") as string) : undefined;

    if (!file || !projectId || !step || !slotKey) {
      return NextResponse.json(
        { success: false, error: "Missing required fields: file, project_id, step, slot_key" },
        { status: 400 }
      );
    }

    // Validate slot exists
    const slotDef = getSlotDef(step, slotKey);
    if (!slotDef) {
      return NextResponse.json(
        { success: false, error: `Unknown slot: ${step}/${slotKey}` },
        { status: 400 }
      );
    }

    // Validate file
    const validation = validateFile(
      { mimeType: file.type, sizeBytes: file.size, width, height, durationMs },
      slotDef
    );
    if (!validation.valid) {
      return NextResponse.json(
        { success: false, error: validation.errors.join("; "), warnings: validation.warnings },
        { status: 422 }
      );
    }

    // Upload to Supabase Storage
    const buffer = await file.arrayBuffer();
    const filename = storageFilename(step, slotKey, file.type);
    const url = await uploadAsset(projectId, filename, buffer, file.type);

    if (!url) {
      return NextResponse.json(
        { success: false, error: "Storage upload failed" },
        { status: 500 }
      );
    }

    // Record in assets table
    await upsertAssetRecord({
      projectId,
      step,
      slotKey,
      filename,
      storagePath: `${projectId}/${filename}`,
      mimeType: file.type,
      sizeBytes: file.size,
      url,
      source: "manual",
      width,
      height,
      durationMs,
    });

    // Patch step output JSONB
    const steps = await getStepsByProject(projectId);
    const existing = steps.find((s) => s.step === step);
    if (existing?.output) {
      const patchedOutput = patchStepOutput(
        existing.output as Record<string, unknown>,
        slotKey,
        url
      );
      await upsertStep(projectId, step, {
        output: patchedOutput,
        status: existing.status === "failed" ? "completed" : existing.status,
      } as Record<string, unknown>);
    }

    // Set modified_at
    await upsertStep(projectId, step, {
      modified_at: new Date().toISOString(),
    } as Record<string, unknown>);

    return NextResponse.json({
      success: true,
      data: {
        url,
        step,
        slot_key: slotKey,
        filename,
        validation: { valid: true, warnings: validation.warnings },
      },
    });
  } catch (error) {
    console.error("[assets/upload]", error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
