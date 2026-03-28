import { NextResponse } from "next/server";
import { getById, getStepsByProject } from "@/lib/store";
import type { Project } from "@/types";
import { buildManifest } from "../assemble/manifest-builder";

export const maxDuration = 15;

export async function POST(request: Request) {
  try {
    const { project_id } = await request.json();

    const project = await getById<Project>("projects", project_id);
    if (!project) {
      return NextResponse.json(
        { success: false, error: "Project not found" },
        { status: 404 }
      );
    }

    const steps = await getStepsByProject(project_id);
    const result = buildManifest(project, steps);

    if (result.error) {
      return NextResponse.json({
        success: true,
        data: {
          valid: false,
          error: result.error,
          scenes: [],
          warnings: [],
          assetCounts: null,
          totalDuration: 0,
        },
      });
    }

    const { scenes, warnings, assetCounts, timingDebug } = result as import("../assemble/manifest-builder").ManifestBuildResult;

    // Per-scene report
    const sceneReport = scenes.map((s) => {
      const mgScene = s as import("../assemble/manifest-builder").MotionGraphicScene;
      const hasAsset =
        s.type === "MOTION_GRAPHIC"
          ? !!(mgScene.imageUrl || mgScene.motionGraphicSpec) // MG with spec will be rendered by worker
          : s.type === "DALLE"
            ? !!(s as { imageUrl?: string }).imageUrl
            : !!(s as { videoUrl?: string }).videoUrl;

      const assetUrl =
        s.type === "DALLE" || s.type === "MOTION_GRAPHIC"
          ? (s as { imageUrl?: string }).imageUrl || null
          : (s as { videoUrl?: string }).videoUrl || null;

      const sceneWarnings: string[] = [];
      if (!hasAsset) sceneWarnings.push(`No ${s.type.toLowerCase()} asset — will render as black`);
      if (s.endTime - s.startTime <= 0) sceneWarnings.push("Zero or negative duration");
      if (s.endTime - s.startTime > 60) sceneWarnings.push("Scene exceeds 60 seconds");

      return {
        sceneIndex: s.sceneIndex,
        type: s.type,
        label: s.label,
        hasAsset,
        assetUrl,
        duration: +(s.endTime - s.startTime).toFixed(2),
        startTime: s.startTime,
        endTime: s.endTime,
        warnings: sceneWarnings,
      };
    });

    // Check for duplicate asset URLs
    const assetUrls = sceneReport.filter((s) => s.assetUrl).map((s) => s.assetUrl!);
    const urlCounts = new Map<string, number>();
    for (const url of assetUrls) {
      urlCounts.set(url, (urlCounts.get(url) || 0) + 1);
    }
    const duplicateAssets = Array.from(urlCounts.entries())
      .filter(([, count]) => count > 1)
      .map(([url, count]) => ({ url: url.slice(0, 80), usedCount: count }));

    if (duplicateAssets.length > 0) {
      warnings.push(`${duplicateAssets.length} assets are used in multiple scenes (images will repeat)`);
    }

    const missingAssets = sceneReport.filter((s) => !s.hasAsset);
    if (missingAssets.length > 0) {
      warnings.push(`${missingAssets.length} scenes have no asset and will render as black`);
    }

    const totalDuration = scenes.reduce((sum, s) => sum + (s.endTime - s.startTime), 0);
    const valid = missingAssets.length === 0 && warnings.length === 0;

    return NextResponse.json({
      success: true,
      data: {
        valid,
        sceneCount: scenes.length,
        totalDuration: +totalDuration.toFixed(2),
        assetCounts,
        scenes: sceneReport,
        duplicateAssets,
        missingAssets: missingAssets.map((s) => ({ sceneIndex: s.sceneIndex, type: s.type, label: s.label })),
        warnings,
        timingDebug,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
