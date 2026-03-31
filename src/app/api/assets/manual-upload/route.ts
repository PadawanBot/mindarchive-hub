/**
 * POST /api/assets/manual-upload — Upload a file without requiring a known slot definition.
 * Used from the Asset Library page for free-form manual uploads.
 * Accepts multipart form data: file, project_id, asset_type, slot_name (optional).
 * Uploads to Supabase Storage and creates/updates an asset record.
 */
import { NextResponse } from "next/server";
import { uploadAsset } from "@/lib/storage";
import { upsertAssetRecord, getPooledAssets } from "@/lib/asset-db";
import { getStepsByProject, upsertStep } from "@/lib/store";
import { patchStepOutput } from "@/lib/asset-patch";
import { parseDalleScenes, parseRunwayScenes } from "@/lib/pipeline/parse-visual-scenes";
import { reconcilePooledAssets } from "@/lib/pipeline/reconcile-pooled-assets";

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

    // Detect whether this is a scene-based upload before visual_direction exists
    const isSceneBased = assetType === "dalle_image" || assetType === "runway_video";
    let pooled = false;

    let slotKey: string;
    if (slotName) {
      slotKey = slotName.trim();
    } else if (isSceneBased) {
      // Check if visual_direction has completed — if not, pool the asset
      const steps = await getStepsByProject(projectId);
      const vdStep = steps.find(s => s.step === "visual_direction" && s.status === "completed");
      if (!vdStep) {
        // No visual direction yet — pool the asset for later reconciliation
        slotKey = `__pool__${Date.now()}`;
        pooled = true;
      } else {
        // Visual direction exists — auto-assign to next available pending scene
        const visuals = (vdStep.output as { visuals?: string })?.visuals || "";
        const scenes = assetType === "dalle_image"
          ? parseDalleScenes(visuals).map(s => ({ ...s, image_url: s.image_url }))
          : parseRunwayScenes(visuals).map(s => ({ ...s, video_url: s.video_url }));
        // Find first pending scene not already filled
        const stepData = steps.find(s => s.step === step);
        const existingScenes = (stepData?.output as { scenes?: { status?: string }[] })?.scenes || [];
        const urlField = assetType === "runway_video" ? "video_url" : "image_url";
        let assignedIndex = -1;
        for (let i = 0; i < scenes.length; i++) {
          const existing = existingScenes[i] as Record<string, unknown> | undefined;
          if (!existing || existing.status !== "completed" || !existing[urlField]) {
            assignedIndex = i;
            break;
          }
        }
        if (assignedIndex >= 0) {
          slotKey = `scenes[${assignedIndex}].${urlField}`;
        } else {
          slotKey = `__pool__${Date.now()}`;
          pooled = true;
        }
      }
    } else if (assetType === "voiceover") {
      // Deterministic key for voiceover — makes prepare-route skip trivial
      slotKey = "audio_url";
    } else {
      slotKey = `${prefix}_manual_${Date.now()}`;
    }

    // Build storage filename — sanitize slotKey to remove brackets/dots for storage path
    const ext = file.name.split(".").pop() || "bin";
    const safeName = sanitizeFilename(file.name);
    const safeSlotKey = slotKey.replace(/[\[\].]/g, "_");
    const storageFilename = `${step}/${safeSlotKey}_${safeName}`;

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

    // Patch step output so the assembler/audit can find the uploaded asset
    // Skip patching for pooled assets — they'll be reconciled when prepare runs
    if (step !== "manual" && !pooled) {
      try {
        const steps = await getStepsByProject(projectId);
        const existing = steps.find((s) => s.step === step);
        const currentOutput = (existing?.output || {}) as Record<string, unknown>;

        if (assetType === "voiceover") {
          // Voiceover: write deterministic output so prepare route skips worker
          await upsertStep(projectId, step, {
            status: "completed",
            output: { ...currentOutput, audio_url: url, source: "manual", status: "completed" },
            modified_at: new Date().toISOString(),
          } as Record<string, unknown>);
        } else if (assetType === "runway_video") {
          // Hero scenes: update SceneVideo[] (new format) or legacy scenes[]
          if (Array.isArray(currentOutput.scenes) && (currentOutput.scenes as Record<string, unknown>[])[0]?.scene_id != null) {
            // New SceneVideo format: find scene by slot_name pattern "scenes[N].video_url"
            const sceneIndexMatch = slotName?.match(/scenes\[(\d+)\]\.video_url/);
            const scenes = [...currentOutput.scenes] as Record<string, unknown>[];
            if (sceneIndexMatch) {
              const idx = parseInt(sceneIndexMatch[1], 10);
              if (idx >= 0 && idx < scenes.length) {
                scenes[idx] = { ...scenes[idx], video_url: url, status: "completed", error: undefined, task_id: `manual_${Date.now()}` };
              }
            }
            await upsertStep(projectId, step, {
              output: { ...currentOutput, status: "completed", scenes, total_requested: scenes.length },
              modified_at: new Date().toISOString(),
            } as Record<string, unknown>);
          } else {
            // Legacy format
            const scenes = Array.isArray(currentOutput.scenes) ? [...currentOutput.scenes] : [];
            scenes.push({
              section: slotName || `Hero Scene ${scenes.length + 1}`,
              promptText: `Manually uploaded: ${file.name}`,
              taskId: `manual_${Date.now()}`,
              video_url: url,
              source: "manual",
            });
            await upsertStep(projectId, step, {
              output: { ...currentOutput, status: "completed", scenes },
              modified_at: new Date().toISOString(),
            } as Record<string, unknown>);
          }
        } else if (assetType === "dalle_image") {
          // DALL-E images: update scenes[] (new format) or images[] (legacy)
          if (Array.isArray(currentOutput.scenes)) {
            // New scene-mapped format: find scene by slot_name pattern "scenes[N].image_url"
            const sceneIndexMatch = slotName?.match(/scenes\[(\d+)\]\.image_url/);
            const scenes = [...currentOutput.scenes] as Record<string, unknown>[];
            if (sceneIndexMatch) {
              const idx = parseInt(sceneIndexMatch[1], 10);
              if (idx >= 0 && idx < scenes.length) {
                scenes[idx] = { ...scenes[idx], image_url: url, status: "completed", error: undefined };
              }
            }
            // Rebuild legacy images[] for backwards compat
            const images = scenes
              .filter((s) => s.status === "completed" && typeof s.image_url === "string")
              .map((s) => ({ url: s.image_url, prompt: s.prompt || "", revised_prompt: s.revised_prompt || "", stored: true }));
            await upsertStep(projectId, step, {
              output: { ...currentOutput, status: "completed", scenes, images, generated: images.length, total_prompts: scenes.length },
              modified_at: new Date().toISOString(),
            } as Record<string, unknown>);
          } else {
            // Legacy flat images[] format
            const images = Array.isArray(currentOutput.images) ? [...currentOutput.images] : [];
            images.push({
              prompt: `Manually uploaded: ${file.name}`,
              url,
              revised_prompt: slotName || file.name,
              stored: true,
              source: "manual",
            });
            await upsertStep(projectId, step, {
              output: { ...currentOutput, status: "completed", images, generated: images.length, total_prompts: images.length },
              modified_at: new Date().toISOString(),
            } as Record<string, unknown>);
          }
        } else {
          // Generic fallback — use path-based patching
          const patchKey = slotName || slotKey;
          const patchedOutput = patchStepOutput(currentOutput, patchKey, url);
          await upsertStep(projectId, step, {
            output: patchedOutput,
            modified_at: new Date().toISOString(),
          } as Record<string, unknown>);
        }
      } catch (patchErr) {
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
        pooled,
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
