import RunwayML from "@runwayml/sdk";

/**
 * Generate a video clip from a text prompt using Runway.
 * Uses textToVideo API — no image needed.
 *
 * Available models:
 * - "veo3"       — 8s clips, high quality (Google Veo 3)
 * - "veo3.1"     — 4/6/8s clips, optional audio
 * - "veo3.1_fast" — faster variant of veo3.1
 * - "gen4.5"     — 2-10s clips (Runway native)
 */
export async function generateVideo(
  apiKey: string,
  promptText: string,
  options?: {
    model?: "veo3" | "veo3.1" | "veo3.1_fast" | "gen4.5";
    duration?: number;
    ratio?: "1280:720" | "720:1280" | "1080:1920" | "1920:1080";
  }
): Promise<{ taskId: string }> {
  const client = new RunwayML({ apiKey });
  const model = options?.model || "veo3";
  const ratio = options?.ratio || "1280:720";

  const task = await client.textToVideo.create({
    model,
    promptText: promptText.slice(0, 1000),
    duration: model === "veo3" ? 8 : (options?.duration || 8),
    ratio,
  } as Parameters<typeof client.textToVideo.create>[0]);

  return { taskId: task.id };
}

// Backward-compatible alias
export async function generateVideoFromImage(
  apiKey: string,
  _imageUrl: string,
  promptText: string,
): Promise<{ taskId: string }> {
  return generateVideo(apiKey, promptText);
}

export async function checkTaskStatus(
  apiKey: string,
  taskId: string
): Promise<{ status: string; outputUrl?: string; error?: string }> {
  const client = new RunwayML({ apiKey });
  const task = await client.tasks.retrieve(taskId);
  const result: { status: string; outputUrl?: string; error?: string } = {
    status: task.status,
  };
  if (task.status === "SUCCEEDED") {
    result.outputUrl = task.output?.[0] || undefined;
  }
  if (task.status === "FAILED") {
    result.error = task.failure || undefined;
  }
  return result;
}
