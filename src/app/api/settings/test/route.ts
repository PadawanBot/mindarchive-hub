import { NextResponse } from "next/server";

export const maxDuration = 30;
export async function POST(request: Request) {
  try {
    const { provider, key } = await request.json();

    if (!key) {
      return NextResponse.json(
        { success: false, error: "No API key provided" },
        { status: 400 }
      );
    }

    switch (provider) {
      case "anthropic_key": {
        const { default: Anthropic } = await import("@anthropic-ai/sdk");
        const client = new Anthropic({ apiKey: key });
        await client.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 10,
          messages: [{ role: "user", content: "Hi" }],
        });
        return NextResponse.json({ success: true });
      }

      case "openai_key": {
        const { default: OpenAI } = await import("openai");
        const client = new OpenAI({ apiKey: key });
        await client.models.list();
        return NextResponse.json({ success: true });
      }

      case "elevenlabs_key": {
        const res = await fetch("https://api.elevenlabs.io/v1/user", {
          headers: { "xi-api-key": key },
        });
        if (!res.ok) throw new Error(`Status ${res.status}`);
        return NextResponse.json({ success: true });
      }

      case "pexels_key": {
        const res = await fetch(
          "https://api.pexels.com/v1/search?query=test&per_page=1",
          { headers: { Authorization: key } }
        );
        if (!res.ok) throw new Error(`Status ${res.status}`);
        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json(
          { success: false, error: "Unknown provider" },
          { status: 400 }
        );
    }
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
