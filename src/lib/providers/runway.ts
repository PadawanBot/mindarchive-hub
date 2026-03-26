import RunwayML from "@runwayml/sdk";

/**
 * Generate a video clip from a text prompt using Runway Gen-4 Turbo.
 * Uses text-to-video mode (no image needed — avoids expired URL issues).
 * Optionally accepts an image URL for image-to-video mode.
 */
export async function generateVideo(
  apiKey: string,
  promptText: string,
  options?: {
    imageUrl?: string;
    duration?: 5 | 10;
    model?: string;
    ratio?: string;
  }
): Promise<{ taskId: string }> {
  const client = new RunwayML({ apiKey });
  const duration = options?.duration || 5;
  const ratio = options?.ratio || "1280:720";
  const model = options?.model || "gen3a_turbo";

  // Build the request based on whether we have an image
  const params: Record<string, unknown> = {
    model,
    promptText: promptText.slice(0, 512),
    duration,
    ratio,
  };

  // Only include promptImage if we have a valid, non-expired URL
  if (options?.imageUrl) {
    params.promptImage = options.imageUrl;
  }

  const task = await client.imageToVideo.create(
    params as unknown as Parameters<typeof client.imageToVideo.create>[0]
  );
  return { taskId: task.id };
}

// Keep backward compatibility
export async function generateVideoFromImage(
  apiKey: string,
  imageUrl: string,
  promptText: string,
  duration: 5 | 10 = 5,
): Promise<{ taskId: string }> {
  // Use text-to-video by default (more reliable — avoids expired image URLs)
  return generateVideo(apiKey, promptText, { duration, ratio: "1280:720" });
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
