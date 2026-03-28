import { NextResponse } from "next/server";
import { getById, getSetting, create } from "@/lib/store";
import { generateWithClaude } from "@/lib/providers/anthropic";
import { generateWithGPT } from "@/lib/providers/openai";
import type { ChannelProfile, TopicSuggestion, TopicBankItem } from "@/types";

const MINE_SYSTEM_PROMPT = `You are a YouTube content strategist specializing in faceless channel growth.
Your job is to discover viral, high-potential video topics that audiences are actively searching for.
Consider trending searches, seasonal relevance, competitor gaps, and evergreen potential.
Always respond with valid JSON.`;

function buildMinePrompt(profile: ChannelProfile): string {
  return `Generate 10 viral video topic suggestions for this YouTube channel:

Channel: ${profile.name}
Niche: ${profile.niche}
Voice style: ${profile.voice_style}
Target audience: ${profile.target_audience}
Description: ${profile.description}

Requirements:
- Mix of trending topics (high short-term potential) and evergreen topics (long-term search traffic)
- Each topic should have a unique angle that differentiates from existing content
- Include topics that explore adjacent niches the audience might be interested in
- Titles should be YouTube-optimized (max 60 chars, click-worthy but not clickbait)

Respond with a JSON array of exactly 10 objects, each with:
- title: string (YouTube-optimized title, max 60 chars)
- angle: string (the unique angle/hook for this topic)
- keywords: string[] (3-5 SEO keywords)
- estimated_interest: "high" | "medium" | "low"
- reasoning: string (why this topic would perform well)

Return ONLY the JSON array, no markdown or explanation.`;
}

export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const { profile_id } = await request.json();

    if (!profile_id) {
      return NextResponse.json({ success: false, error: "profile_id is required" }, { status: 400 });
    }

    const profile = await getById<ChannelProfile>("profiles", profile_id);
    if (!profile) {
      return NextResponse.json({ success: false, error: "Channel profile not found" }, { status: 404 });
    }

    // Determine LLM
    const llmProvider = profile.llm_provider || (await getSetting("default_llm")) || "anthropic";
    const llmModel = profile.llm_model || (await getSetting("default_model")) || "claude-sonnet-4-6";

    const userPrompt = buildMinePrompt(profile);
    let responseText: string;

    if (llmProvider === "anthropic") {
      const apiKey = await getSetting("anthropic_key");
      if (!apiKey) {
        return NextResponse.json({ success: false, error: "Anthropic API key not configured" }, { status: 400 });
      }
      const result = await generateWithClaude(apiKey, llmModel, MINE_SYSTEM_PROMPT, userPrompt);
      responseText = result.text;
    } else {
      const apiKey = await getSetting("openai_key");
      if (!apiKey) {
        return NextResponse.json({ success: false, error: "OpenAI API key not configured" }, { status: 400 });
      }
      const result = await generateWithGPT(apiKey, llmModel, MINE_SYSTEM_PROMPT, userPrompt);
      responseText = result.text;
    }

    // Parse JSON
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return NextResponse.json({ success: false, error: "Failed to parse AI response" }, { status: 500 });
    }

    const suggestions: TopicSuggestion[] = JSON.parse(jsonMatch[0]);

    // Save all to topic bank
    const created: TopicBankItem[] = [];
    for (const topic of suggestions) {
      const item = await create<TopicBankItem>("topic_bank", {
        profile_id,
        title: topic.title,
        angle: topic.angle,
        keywords: topic.keywords,
        estimated_interest: topic.estimated_interest,
        reasoning: topic.reasoning,
        status: "available",
      } as Omit<TopicBankItem, "id" | "created_at" | "updated_at">);
      created.push(item);
    }

    return NextResponse.json({ success: true, data: created });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
