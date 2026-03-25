import { getAllSettings } from "@/lib/store";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const { provider, model, system, prompt, maxTokens } = await request.json();

    if (!provider || !model || !system || !prompt) {
      return Response.json({ success: false, error: "Missing required fields" }, { status: 400 });
    }

    // Read API key server-side (never exposed to client)
    const settings = await getAllSettings();
    const apiKey = provider === "anthropic" ? settings.anthropic_key : settings.openai_key;
    if (!apiKey) {
      return Response.json({ success: false, error: `${provider} API key not configured` }, { status: 400 });
    }

    if (provider !== "anthropic") {
      // For OpenAI, fall back to non-streaming (usually fast enough)
      const { generateWithGPT } = await import("@/lib/providers/openai");
      const result = await generateWithGPT(apiKey, model, system, prompt, maxTokens || 4096);
      return Response.json({ success: true, data: result });
    }

    // Stream from Anthropic → client
    const client = new Anthropic({ apiKey });
    const stream = client.messages.stream({
      model,
      max_tokens: maxTokens || 4096,
      system,
      messages: [{ role: "user", content: prompt }],
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        let inputTokens = 0;
        let outputTokens = 0;

        try {
          stream.on("text", (delta) => {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "text", text: delta })}\n\n`));
          });

          const finalMessage = await stream.finalMessage();
          inputTokens = finalMessage.usage.input_tokens;
          outputTokens = finalMessage.usage.output_tokens;

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: "done",
            inputTokens,
            outputTokens,
          })}\n\n`));
        } catch (error) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: "error",
            error: String(error),
          })}\n\n`));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return Response.json({ success: false, error: String(error) }, { status: 500 });
  }
}
