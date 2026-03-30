/**
 * POST /api/pipeline/step/regenerate-scene
 * Regenerate a single DALL-E scene image with an optionally modified prompt.
 *
 * Body: { project_id: string, scene_id: number, prompt: string }
 * Returns: { success: true, scene: SceneImage } or { success: false, rejected?: boolean, error: string }
 */
import { NextResponse } from "next/server";
import { getAllSettings, getStepsByProject, upsertStep } from "@/lib/store";
import { generateImage } from "@/lib/providers/openai";
import { downloadAndStore } from "@/lib/storage";
import type { SceneImage } from "@/types";

export const maxDuration = 60;

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
    const apiKey = settings.openai_key;
    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: "No OpenAI API key configured" },
        { status: 400 }
      );
    }

    // Generate image
    let imageUrl: string;
    let revisedPrompt: string;
    try {
      const result = await generateImage(apiKey, prompt);
      imageUrl = result.url;
      revisedPrompt = result.revisedPrompt;
    } catch (err) {
      const errMsg = String(err);
      const isContentPolicy = errMsg.includes("content_policy") || errMsg.includes("safety");
      return NextResponse.json({
        success: false,
        rejected: isContentPolicy,
        error: isContentPolicy ? "Content policy violation — edit the prompt and try again" : errMsg,
      });
    }

    // Store to R2
    const storedUrl = await downloadAndStore(
      project_id, `dalle-scene-${String(scene_id).padStart(3, "0")}.png`, imageUrl, "image/png"
    );
    const finalUrl = storedUrl || imageUrl;

    // Update step output — merge updated scene into existing scenes[]
    const steps = await getStepsByProject(project_id);
    const imageStep = steps.find(s => s.step === "image_generation");
    const existingOutput = (imageStep?.output || {}) as Record<string, unknown>;
    const existingScenes: SceneImage[] = (existingOutput.scenes as SceneImage[]) || [];

    const updatedScene: SceneImage = {
      scene_id,
      label: existingScenes.find(s => s.scene_id === scene_id)?.label || "",
      prompt,
      image_url: finalUrl,
      revised_prompt: revisedPrompt,
      status: "completed",
      ken_burns: existingScenes.find(s => s.scene_id === scene_id)?.ken_burns,
    };

    // Replace or append scene
    const sceneIdx = existingScenes.findIndex(s => s.scene_id === scene_id);
    const updatedScenes = [...existingScenes];
    if (sceneIdx !== -1) {
      updatedScenes[sceneIdx] = updatedScene;
    } else {
      updatedScenes.push(updatedScene);
    }

    // Rebuild legacy images[]
    const images = updatedScenes
      .filter(s => s.status === "completed" && s.image_url)
      .map(s => ({ url: s.image_url!, prompt: s.prompt, revised_prompt: s.revised_prompt || "", stored: true }));

    await upsertStep(project_id, "image_generation", {
      status: "completed",
      output: {
        ...existingOutput,
        scenes: updatedScenes,
        images,
        total_prompts: updatedScenes.length,
        generated: images.length,
      },
    });

    return NextResponse.json({ success: true, scene: updatedScene });
  } catch (err) {
    console.error("[regenerate-scene] Error:", err);
    return NextResponse.json(
      { success: false, error: String(err) },
      { status: 500 }
    );
  }
}
