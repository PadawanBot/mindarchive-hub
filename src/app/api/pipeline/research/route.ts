import { NextResponse } from "next/server";
import { getSetting } from "@/lib/store";
import { getById } from "@/lib/store";
import { generateWithClaude } from "@/lib/providers/anthropic";
import { generateWithGPT } from "@/lib/providers/openai";
import type { ChannelProfile, TopicSuggestion } from "@/types";

const RESEARCH_SYSTEM_PROMPT = `You are a YouTube content strategist specializing in faceless channel growth.
Your job is to suggest compelling video topics that will perform well on YouTube.
Consider search volume, competition, audience interest, and trending potential.
Always respond with valid JSON.`;

function buildResearchPrompt(niche: string, profile?: ChannelProfile | null): string {
  let prompt = `Generate 5 video topic suggestions for the niche: "${niche}"

Each topic should have strong YouTube potential — searchable, clickable, and watchable.`;

  if (profile) {
    prompt += `\n\nChannel context:
- Channel: ${profile.name}
- Voice style: ${profile.voice_style}
- Target audience: ${profile.target_audience}
- Description: ${profile.description}`;
  }

  prompt += `\n\nRespond with a JSON array of exactly 5 objects, each with:
- title: string (YouTube-optimized title, max 60 chars)
- angle: string (the unique angle/hook for this topic)
- keywords: string[] (3-5 SEO keywords)
- estimated_interest: "high" | "medium" | "low"
- reasoning: string (why this topic would perform well)

Return ONLY the JSON array, no markdown or explanation.`;

  return prompt;
}

export async function POST(request: Request) {
  try {
    const { niche, profile_id } = await request.json();

    if (!niche) {
      return NextResponse.json(
        { success: false, error: "Niche is required" },
        { status: 400 }
      );
    }

    // Get profile if provided
    let profile: ChannelProfile | undefined;
    if (profile_id) {
      profile = await getById<ChannelProfile>("profiles", profile_id);
    }

    // Determine which LLM to use
    const llmProvider = profile?.llm_provider || (await getSetting("default_llm")) || "anthropic";
    const llmModel = profile?.llm_model || (await getSetting("default_model")) || "claude-sonnet-4-6";

    const userPrompt = buildResearchPrompt(niche, profile);
    let responseText: string;

    if (llmProvider === "anthropic") {
      const apiKey = await getSetting("anthropic_key");
      if (!apiKey) {
        return NextResponse.json(
          { success: false, error: "Anthropic API key not configured. Go to Settings." },
          { status: 400 }
        );
      }
      const result = await generateWithClaude(apiKey, llmModel, RESEARCH_SYSTEM_PROMPT, userPrompt);
      responseText = result.text;
    } else {
      const apiKey = await getSetting("openai_key");
      if (!apiKey) {
        return NextResponse.json(
          { success: false, error: "OpenAI API key not configured. Go to Settings." },
          { status: 400 }
        );
      }
      const result = await generateWithGPT(apiKey, llmModel, RESEARCH_SYSTEM_PROMPT, userPrompt);
      responseText = result.text;
    }

    // Parse the JSON response
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return NextResponse.json(
        { success: false, error: "Failed to parse AI response" },
        { status: 500 }
      );
    }

    const suggestions: TopicSuggestion[] = JSON.parse(jsonMatch[0]);

    return NextResponse.json({ success: true, data: suggestions });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
