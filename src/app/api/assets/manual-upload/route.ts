/**
 * POST /api/assets/manual-upload — Upload a file without requiring a known slot definition.
 * Used from the Asset Library page for free-form manual uploads.
 * Accepts multipart form data: file, project_id, asset_type, slot_name (optional).
 * Uploads to Supabase Storage and creates/updates an asset record.
 */
import { NextResponse } from "next/server";
import { uploadAsset } from "@/lib/storage";
import { upsertAssetRecord } from "@/lib/asset-db";
import { getStepsByProject, upsertStep } from "@/lib/store";
import { patchStepOutput } from "@/lib/asset-patch";

export const maxDuration = 30;

/** Map user-facing asset_type to the pipeline step name */
const ASSET_TYPE_TO_STEP: Record<string, string> = {
  dalle_image: "image_generation",
  runway_video: "hero_scenes",
  stock_video: "stock_footage",
  voiceover: "voiceover_generation",
  motion_graphic: "motion_graphics",
  other: "manual",
};

/** Map user-facing asset_type to a default slot key prefix */
const ASSET_TYPE_SLOT_PREFIX: Record<string, string> = {
  dalle_image: "images",
  runway_video: "scenes",
  stock_video: "stock_clips",
  voiceover: "audio_url",
  motion_graphic: "motion",
  other: "manual",
};

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const projectId = formData.get("project_id") as string;
    const assetType = formData.get("asset_type") as string;
    const slotName = (formData.get("slot_name") as string) || "";

    if (!file || !projectId || !assetType) {
      return NextResponse.json(
        { success: false, error: "Missing required fields: file, project_id, asset_type" },
        { status: 400 }
      );
    }

    if (!ASSET_TYPE_TO_STEP[assetType]) {
      return NextResponse.json(
        { success: false, error: `Unknown asset_type: ${assetType}` },
        { status: 400 }
      );
    }

    // Basic file validation
    const maxSize = 50 * 1024 * 1024; // 50MB
    if (file.size > maxSize) {
      return NextResponse.json(
        { success: false, error: `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum is 50MB.` },
        { status: 422 }
      );
    }

    const step = ASSET_TYPE_TO_STEP[assetType];
    const prefix = ASSET_TYPE_SLOT_PREFIX[assetType];

    // Build slot key from user input or generate one
    const slotKey = slotName
      ? slotName.trim()
      : `${prefix}_manual_${Date.now()}`;

    // Build storage filename
    const ext = file.name.split(".").pop() || "bin";
    const safeName = sanitizeFilename(file.name);
    const storageFilename = `${step}/${slotKey}_${safeName}`;

    // Upload to Supabase Storage
    const buffer = await file.arrayBuffer();
    const url = await uploadAsset(projectId, storageFilename, buffer, file.type);

    if (!url) {
      return NextResponse.json(
        { success: false, error: "Storage upload failed. Is Supabase configured?" },
        { status: 500 }
      );
    }

    // Record in assets table
    const record = await upsertAssetRecord({
      projectId,
      step,
      slotKey,
      filename: safeName,
      storagePath: `${projectId}/${storageFilename}`,
      mimeType: file.type,
      sizeBytes: file.size,
      url,
      source: "manual",
    });

    // For runway hero scenes, also patch the hero_scenes step output so the
    // assembler can find the video. Same for other asset types with step outputs.
    if (step !== "manual") {
      try {
        const steps = await getStepsByProject(projectId);
        const existing = steps.find((s) => s.step === step);
        if (existing?.output) {
          // Attempt to patch the step output with the new URL
          const patchKey = slotName || slotKey;
          const patchedOutput = patchStepOutput(
            existing.output as Record<string, unknown>,
            patchKey,
            url
          );
          await upsertStep(projectId, step, {
            output: patchedOutput,
            modified_at: new Date().toISOString(),
          } as Record<string, unknown>);
        }
      } catch (patchErr) {
        // Step output patching is best-effort
        console.warn("[manual-upload] Step output patch failed (non-fatal):", patchErr);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        id: record?.id || null,
        url,
        step,
        slot_key: slotKey,
        filename: safeName,
        asset_type: assetType,
      },
    });
  } catch (error) {
    console.error("[assets/manual-upload]", error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
