import RunwayML from "@runwayml/sdk";

export async function generateVideoFromImage(
  apiKey: string,
  imageUrl: string,
  promptText: string,
  duration: 5 | 10 = 5,
  model: "gen4_turbo" | "gen4.5" | "gen3a_turbo" = "gen4_turbo"
): Promise<{ taskId: string }> {
  const client = new RunwayML({ apiKey });
  // Use type assertion for the discriminated union — model drives the variant
  const task = await client.imageToVideo.create({
    model,
    promptImage: imageUrl,
    promptText: promptText.slice(0, 512), // 512 char limit
    duration,
  } as Parameters<typeof client.imageToVideo.create>[0]);
  return { taskId: task.id };
}

export async function checkTaskStatus(
  apiKey: string,
  taskId: string
): Promise<{ status: string; outputUrl?: string; error?: string }> {
  const client = new RunwayML({ apiKey });
  const task = await client.tasks.retrieve(taskId);
  // TaskRetrieveResponse is a discriminated union by status
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
