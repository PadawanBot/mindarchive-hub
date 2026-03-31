/**
 * GET /api/assets/pool-status — Returns the current state of pooled assets and scene definitions
 * for the re-assignment UI on the assets page.
 */
import { NextResponse } from "next/server";
import { getStepsByProject } from "@/lib/store";
import { getPooledAssets, listProjectAssets } from "@/lib/asset-db";
import { parseDalleScenes, parseRunwayScenes } from "@/lib/pipeline/parse-visual-scenes";
import type { SceneImage, SceneVideo } from "@/types";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("project_id");
    const step = searchParams.get("step");

    if (!projectId || !step) {
      return NextResponse.json(
        { success: false, error: "Missing required params: project_id, step" },
        { status: 400 },
      );
    }

    if (step !== "image_generation" && step !== "hero_scenes") {
      return NextResponse.json(
        { success: false, error: "step must be image_generation or hero_scenes" },
        { status: 400 },
      );
    }

    const existingSteps = await getStepsByProject(projectId);

    // Check visual direction status
    const vdStep = existingSteps.find(s => s.step === "visual_direction" && s.status === "completed");
    const visualDirectionReady = !!vdStep;

    // Parse scenes from visual direction if available
    let scenes: (SceneImage | SceneVideo)[] = [];
    if (vdStep) {
      const visuals = (vdStep.output as { visuals?: string })?.visuals || "";
      scenes = step === "image_generation"
        ? parseDalleScenes(visuals)
        : parseRunwayScenes(visuals);
    }

    // Get pooled assets for this step
    const pooledAssets = await getPooledAssets(projectId, step);

    // Get all manual assets for this step (including already-assigned ones)
    const allAssets = await listProjectAssets(projectId);
    const manualAssetsForStep = allAssets.filter(
      a => a.step === step && a.source === "manual",
    );

    // Get current step output scenes if they exist
    const stepData = existingSteps.find(s => s.step === step);
    const currentOutputScenes = (stepData?.output as { scenes?: unknown[] })?.scenes || [];

    return NextResponse.json({
      success: true,
      data: {
        pooled_assets: pooledAssets,
        manual_assets: manualAssetsForStep,
        scenes,
        current_output_scenes: currentOutputScenes,
        visual_direction_ready: visualDirectionReady,
      },
    });
  } catch (error) {
    console.error("[assets/pool-status]", error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 },
    );
  }
}
