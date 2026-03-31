/**
 * POST /api/assets/reassign — Re-assign pooled/manual assets to specific scene slots.
 * Used from the AssetReassignmentPanel after visual_direction completes.
 */
import { NextResponse } from "next/server";
import { getStepsByProject, upsertStep } from "@/lib/store";
import { getAssetById, updateAssetSlotKey } from "@/lib/asset-db";
import { parseDalleScenes, parseRunwayScenes } from "@/lib/pipeline/parse-visual-scenes";
import type { SceneImage, SceneVideo } from "@/types";

interface Mapping {
  asset_id: string;
  scene_id: number;
}

export async function POST(request: Request) {
  try {
    const { project_id, step, mappings } = (await request.json()) as {
      project_id: string;
      step: string;
      mappings: Mapping[];
    };

    if (!project_id || !step || !Array.isArray(mappings) || mappings.length === 0) {
      return NextResponse.json(
        { success: false, error: "Missing required fields: project_id, step, mappings[]" },
        { status: 400 },
      );
    }

    if (step !== "image_generation" && step !== "hero_scenes") {
      return NextResponse.json(
        { success: false, error: "step must be image_generation or hero_scenes" },
        { status: 400 },
      );
    }

    const existingSteps = await getStepsByProject(project_id);

    // Parse scenes from visual direction
    const vdStep = existingSteps.find(s => s.step === "visual_direction" && s.status === "completed");
    if (!vdStep) {
      return NextResponse.json(
        { success: false, error: "visual_direction must be completed before reassigning" },
        { status: 400 },
      );
    }

    const visuals = (vdStep.output as { visuals?: string })?.visuals || "";
    const urlField = step === "hero_scenes" ? "video_url" : "image_url";

    // Parse fresh scene definitions
    const parsedScenes: (SceneImage | SceneVideo)[] = step === "image_generation"
      ? parseDalleScenes(visuals)
      : parseRunwayScenes(visuals);

    if (parsedScenes.length === 0) {
      return NextResponse.json(
        { success: false, error: "No scenes found in visual direction" },
        { status: 400 },
      );
    }

    // Get current step output to carry forward non-remapped completed scenes
    const stepData = existingSteps.find(s => s.step === step);
    const currentScenes = ((stepData?.output as { scenes?: Record<string, unknown>[] })?.scenes || []) as Record<string, unknown>[];

    // Build scenes array from parsed definitions, carrying forward existing data
    const scenes = parsedScenes.map((parsed, idx) => {
      const existing = currentScenes[idx] || {};
      return { ...parsed, ...existing };
    }) as Record<string, unknown>[];

    // Apply each mapping
    const applied: { asset_id: string; scene_id: number; slot_key: string }[] = [];
    for (const mapping of mappings) {
      const asset = await getAssetById(mapping.asset_id);
      if (!asset || !asset.url) {
        console.warn(`[reassign] Asset ${mapping.asset_id} not found or has no URL`);
        continue;
      }

      // Find the scene index for this scene_id
      const sceneIndex = parsedScenes.findIndex(s => s.scene_id === mapping.scene_id);
      if (sceneIndex < 0) {
        console.warn(`[reassign] Scene ID ${mapping.scene_id} not found in parsed scenes`);
        continue;
      }

      const canonicalSlotKey = `scenes[${sceneIndex}].${urlField}`;

      // Update asset record's slot_key
      await updateAssetSlotKey(asset.id, canonicalSlotKey);

      // Mark scene as completed with the asset URL
      scenes[sceneIndex] = {
        ...scenes[sceneIndex],
        [urlField]: asset.url,
        status: "completed",
        ...(step === "hero_scenes" ? { task_id: `manual_${Date.now()}` } : {}),
      };

      applied.push({ asset_id: asset.id, scene_id: mapping.scene_id, slot_key: canonicalSlotKey });
    }

    // Persist updated step output
    const completedCount = scenes.filter(s => s.status === "completed" && s[urlField]).length;
    await upsertStep(project_id, step, {
      output: {
        scenes,
        status: completedCount === scenes.length ? "completed" : "running",
        ...(step === "image_generation"
          ? { total_prompts: scenes.length, generated: completedCount }
          : { total_requested: scenes.length }),
      },
      modified_at: new Date().toISOString(),
    } as Record<string, unknown>);

    console.log(`[reassign] ${step}: applied ${applied.length} mappings for project ${project_id}`);

    return NextResponse.json({
      success: true,
      data: {
        applied,
        scenes,
        total_scenes: scenes.length,
        completed: completedCount,
      },
    });
  } catch (error) {
    console.error("[assets/reassign]", error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 },
    );
  }
}
