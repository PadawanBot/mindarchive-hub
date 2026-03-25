import Anthropic from "@anthropic-ai/sdk";

/**
 * Generate text with Claude using the streaming API.
 * Includes an internal abort timeout (default 50s) so the call
 * returns gracefully before Vercel Hobby's 60s hard limit.
 */
export async function generateWithClaude(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number = 4096,
  timeoutMs: number = 50_000
): Promise<{ text: string; inputTokens: number; outputTokens: number; truncated?: boolean }> {
  const client = new Anthropic({ apiKey });

  let text = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let truncated = false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const stream = client.messages.stream(
      {
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      },
      { signal: controller.signal as AbortSignal }
    );

    stream.on("text", (delta) => {
      text += delta;
    });

    const finalMessage = await stream.finalMessage();
    inputTokens = finalMessage.usage.input_tokens;
    outputTokens = finalMessage.usage.output_tokens;
  } catch (error: unknown) {
    const isAbort =
      (error instanceof Error && error.name === "AbortError") ||
      controller.signal.aborted;

    if (isAbort && text.length > 0) {
      // Graceful abort — return whatever we streamed so far
      truncated = true;
      if (outputTokens === 0) outputTokens = Math.ceil(text.length / 4);
    } else {
      throw error;
    }
  } finally {
    clearTimeout(timer);
  }

  return { text, inputTokens, outputTokens, truncated };
}
