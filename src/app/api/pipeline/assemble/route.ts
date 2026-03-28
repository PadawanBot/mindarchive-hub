import { NextResponse } from "next/server";
import { getById, getStepsByProject } from "@/lib/store";
import type { Project, StepResult } from "@/types";
import { buildManifest } from "./manifest-builder";

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
    const workerUrl = process.env.WORKER_URL;

    if (!workerUrl) {
      return NextResponse.json(
        {
          success: false,
          error:
            "WORKER_URL not configured. Deploy the video assembly worker and set the WORKER_URL env var.",
        },
        { status: 400 }
      );
    }

    const result = buildManifest(project, steps);
    if (result.error) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    const { manifest, scenes } = result as import("./manifest-builder").ManifestBuildResult;

    // ── Send to worker ──
    // Always use production URL — preview URLs have Vercel deployment protection (401)
    const callbackUrl = "https://mindarchive-hub.vercel.app/api/pipeline/assemble/callback";
    const workerRes = await fetch(`${workerUrl}/assemble`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.WORKER_SECRET
          ? { Authorization: `Bearer ${process.env.WORKER_SECRET}` }
          : {}),
      },
      body: JSON.stringify({ manifest, callbackUrl }),
    });

    if (!workerRes.ok) {
      const errText = await workerRes.text();
      return NextResponse.json(
        { success: false, error: `Worker error: ${errText}` },
        { status: 500 }
      );
    }

    const { jobId } = await workerRes.json();

    return NextResponse.json({
      success: true,
      data: {
        jobId,
        workerUrl,
        status: "queued",
        sceneCount: scenes.length,
        assetTypes: {
          dalle: scenes.filter((s) => s.type === "DALLE").length,
          stock: scenes.filter((s) => s.type === "STOCK").length,
          runway: scenes.filter((s) => s.type === "RUNWAY").length,
          motionGraphic: scenes.filter((s) => s.type === "MOTION_GRAPHIC").length,
        },
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
