/**
 * POST /api/pipeline/step/regenerate-hero-scene
 * Regenerate a single Runway hero scene video with an optionally modified prompt.
 * Submits to Runway, polls until complete (up to 5 min), then stores to R2.
 *
 * Body: { project_id: string, scene_id: number, prompt: string }
 * Returns: { success: true, scene: SceneVideo } or { success: false, error: string }
 */
import { NextResponse } from "next/server";
import { getAllSettings, getStepsByProject, upsertStep } from "@/lib/store";
import { generateVideo, checkTaskStatus } from "@/lib/providers/runway";
import { downloadAndStore } from "@/lib/storage";
import type { SceneVideo } from "@/types";

export const maxDuration = 300; // 5 minutes for Runway polling

export async function POST(request: Request) {
  try {
    const { project_id, scene_id, prompt } = await request.json();

    if (!project_id || scene_id == null || !prompt) {
      return NextResponse.json(
        { success: false, error: "Missing required fields: project_id, scene_id, prompt" },
        { status: 400 }
      );
    }

    const settings = await getAllSettings();
    const apiKey = settings.runway_key;
    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: "No Runway API key configured" },
        { status: 400 }
      );
    }

    // Submit to Runway
    let taskId: string;
    try {
      const result = await generateVideo(apiKey, prompt);
      taskId = result.taskId;
    } catch (err) {
      const errMsg = String(err);
      const isContentPolicy = errMsg.toLowerCase().includes("content") && errMsg.toLowerCase().includes("policy");
      return NextResponse.json({
        success: false,
        rejected: isContentPolicy,
        error: isContentPolicy ? "Content policy violation — edit the prompt and try again" : errMsg,
      });
    }

    console.log(`[regenerate-hero-scene] Scene ${scene_id} submitted → task ${taskId}`);

    // Poll until complete (max 5 min = 60 polls × 5s)
    let videoUrl: string | null = null;
    let failureReason: string | null = null;

    for (let poll = 0; poll < 60; poll++) {
      await new Promise(r => setTimeout(r, 5000));

      try {
        const status = await checkTaskStatus(apiKey, taskId);
        if (status.status === "SUCCEEDED" && status.outputUrl) {
          videoUrl = status.outputUrl;
          break;
        }
        if (status.status === "FAILED") {
          failureReason = status.error || "Runway generation failed";
          break;
        }
      } catch {}
    }

    if (!videoUrl) {
      return NextResponse.json({
        success: false,
        error: failureReason || "Runway generation timed out after 5 minutes",
      });
    }

    // Store to R2 via Supabase storage
    const storedUrl = await downloadAndStore(
      project_id, `runway-scene-${String(scene_id).padStart(3, "0")}.mp4`, videoUrl, "video/mp4"
    );
    const finalUrl = storedUrl || videoUrl;

    // Update step output
    const steps = await getStepsByProject(project_id);
    const heroStep = steps.find(s => s.step === "hero_scenes");
    const existingOutput = (heroStep?.output || {}) as Record<string, unknown>;
    const existingScenes: SceneVideo[] = (existingOutput.scenes as SceneVideo[]) || [];

    const updatedScene: SceneVideo = {
      scene_id,
      label: existingScenes.find(s => s.scene_id === scene_id)?.label || "",
      prompt,
      video_url: finalUrl,
      task_id: taskId,
      status: "completed",
      motion_type: existingScenes.find(s => s.scene_id === scene_id)?.motion_type,
    };

    const sceneIdx = existingScenes.findIndex(s => s.scene_id === scene_id);
    const updatedScenes = [...existingScenes];
    if (sceneIdx !== -1) {
      updatedScenes[sceneIdx] = updatedScene;
    } else {
      updatedScenes.push(updatedScene);
    }

    await upsertStep(project_id, "hero_scenes", {
      status: "completed",
      output: {
        ...existingOutput,
        scenes: updatedScenes,
        status: "completed",
        total_requested: updatedScenes.length,
      },
    });

    return NextResponse.json({ success: true, scene: updatedScene });
  } catch (err) {
    console.error("[regenerate-hero-scene] Error:", err);
    return NextResponse.json(
      { success: false, error: String(err) },
      { status: 500 }
    );
  }
}
