import { NextResponse } from "next/server";
import { getById, update, getSetting } from "@/lib/store";
import { generateWithClaude } from "@/lib/providers/anthropic";
import { generateWithGPT } from "@/lib/providers/openai";
import type { Project, ChannelProfile, PipelineStep } from "@/types";

// Allow up to 60s on Vercel Hobby
export const maxDuration = 60;

// Ordered pipeline steps
const PIPELINE: PipelineStep[] = [
  "topic_research",
  "script_writing",
  "hook_generation",
  "script_refinement",
  "voiceover_generation",
  "visual_direction",
  "thumbnail_creation",
  "video_assembly",
];

async function getLLM(profile?: ChannelProfile) {
  const provider = profile?.llm_provider || (await getSetting("default_llm")) || "anthropic";
  const model = profile?.llm_model || (await getSetting("default_model")) || "claude-sonnet-4-6";
  const key = provider === "anthropic"
    ? await getSetting("anthropic_key")
    : await getSetting("openai_key");
  return { provider, model, key };
}

async function callLLM(
  provider: string,
  model: string,
  key: string,
  system: string,
  prompt: string
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  if (provider === "anthropic") {
    return generateWithClaude(key, model, system, prompt);
  }
  return generateWithGPT(key, model, system, prompt);
}

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing: Record<string, { input: number; output: number }> = {
    "claude-sonnet-4-6": { input: 300, output: 1500 },
    "claude-opus-4-6": { input: 1500, output: 7500 },
    "claude-haiku-4-5-20251001": { input: 80, output: 400 },
    "gpt-4o": { input: 250, output: 1000 },
    "gpt-4o-mini": { input: 15, output: 60 },
  };
  const p = pricing[model] || pricing["claude-sonnet-4-6"];
  return Math.ceil((inputTokens * p.input + outputTokens * p.output) / 1_000_000);
}

interface StepResultData {
  step: string;
  status: "completed" | "failed" | "skipped";
  output?: Record<string, unknown>;
  error?: string;
  cost_cents?: number;
  duration_ms?: number;
}

export async function POST(request: Request) {
  try {
    const { project_id } = await request.json();
    const project = await getById<Project>("projects", project_id);
    if (!project) {
      return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
    }

    const profile = project.profile_id
      ? await getById<ChannelProfile>("profiles", project.profile_id)
      : undefined;

    const { provider, model, key } = await getLLM(profile);
    if (!key) {
      return NextResponse.json(
        { success: false, error: `${provider} API key not configured. Go to Settings to add it.` },
        { status: 400 }
      );
    }

    await update<Project>("projects", project_id, {
      status: "researching",
    } as Partial<Project>);

    const completedSteps: StepResultData[] = [];
    let totalCost = 0;
    let scriptText = "";

    for (const stepName of PIPELINE) {
      const startTime = Date.now();
      const stepData: StepResultData = { step: stepName, status: "completed" };

      try {
        let result: { text: string; inputTokens: number; outputTokens: number };

        switch (stepName) {
          case "topic_research": {
            result = await callLLM(provider, model, key,
              "You are a YouTube content researcher. Analyze the topic and provide detailed research including key talking points, data, statistics, and interesting facts. Output as JSON with fields: talking_points (array), statistics (array), key_facts (array), audience_hooks (array).",
              `Research this topic thoroughly for a YouTube video: "${project.topic}"\n\nChannel niche: ${profile?.niche || "general"}\nTarget audience: ${profile?.target_audience || "general"}`
            );
            stepData.output = { research: result.text };
            const cost = estimateCost(model, result.inputTokens, result.outputTokens);
            stepData.cost_cents = cost;
            totalCost += cost;
            break;
          }

          case "script_writing": {
            const research = completedSteps.find(s => s.step === "topic_research")?.output?.research as string || "";
            result = await callLLM(provider, model, key,
              `You are an expert YouTube scriptwriter for faceless channels. Write engaging, hook-driven scripts. The voiceover MP3 is the production clock — word count drives runtime. NEVER include text instructions for DALL-E in the narration. MOTION_GRAPHIC tags are visual supplements only.\n\nVoice style: ${profile?.voice_style || "professional"}`,
              `Write a full YouTube script for: "${project.topic}"\n\nResearch data:\n${research}\n\nFormat requirements:\n- Target word count: 1000-1400 words\n- Include [VISUAL CUE] tags for each section describing what the viewer should see\n- Start with a strong hook (first 5 seconds)\n- Include a clear CTA at the end\n- Write in sections: HOOK, INTRO, BODY (3-4 sections), CONCLUSION, CTA\n\nOutput the complete narration script with [VISUAL CUE: description] tags between sections.`
            );
            scriptText = result.text;
            stepData.output = { script: result.text };
            const cost = estimateCost(model, result.inputTokens, result.outputTokens);
            stepData.cost_cents = cost;
            totalCost += cost;
            await update<Project>("projects", project_id, {
              status: "scripting",
              script_data: { raw: result.text },
            } as unknown as Partial<Project>);
            break;
          }

          case "hook_generation": {
            result = await callLLM(provider, model, key,
              "You are a viral hook specialist. Generate 3 alternative hooks for YouTube videos that maximize click-through and retention in the first 5 seconds.",
              `Generate 3 alternative hooks for this video:\n\nTopic: "${project.topic}"\n\nCurrent script opening:\n${scriptText.slice(0, 500)}\n\nReturn as JSON array with fields: hook_text, hook_type (question/statistic/bold_claim/story), estimated_retention_boost`
            );
            stepData.output = { hooks: result.text };
            const cost = estimateCost(model, result.inputTokens, result.outputTokens);
            stepData.cost_cents = cost;
            totalCost += cost;
            break;
          }

          case "script_refinement": {
            result = await callLLM(provider, model, key,
              "You are a YouTube script editor. Refine scripts for maximum engagement, clarity, and retention. Ensure smooth transitions, eliminate filler, and strengthen the narrative arc.",
              `Refine this YouTube script. Improve pacing, add stronger transitions, and ensure the hook is irresistible:\n\n${scriptText}\n\nReturn the complete refined script.`
            );
            scriptText = result.text;
            stepData.output = { refined_script: result.text };
            const cost = estimateCost(model, result.inputTokens, result.outputTokens);
            stepData.cost_cents = cost;
            totalCost += cost;
            await update<Project>("projects", project_id, {
              script_data: { raw: scriptText, refined: result.text },
            } as unknown as Partial<Project>);
            break;
          }

          case "voiceover_generation": {
            const elevenLabsKey = await getSetting("elevenlabs_key");
            if (elevenLabsKey && profile?.voice_id) {
              stepData.output = { status: "ready", voice_id: profile.voice_id };
            } else {
              stepData.output = {
                status: "skipped",
                reason: !elevenLabsKey ? "No ElevenLabs key" : "No voice ID in profile",
              };
              stepData.status = "skipped";
            }
            break;
          }

          case "visual_direction": {
            result = await callLLM(provider, model, key,
              "You are a visual director for YouTube videos. Create a visual plan with DALL-E image prompts and stock footage search queries. CRITICAL: Never include text in DALL-E prompts — all text overlays are handled by Pillow in post-production.",
              `Create a visual direction plan for this script:\n\n${scriptText.slice(0, 2000)}\n\nFor each section, provide:\n1. A DALL-E image prompt (NO TEXT in the image)\n2. Pexels search query for B-roll\n3. Motion graphic suggestion\n\nReturn as JSON array with fields: section, dalle_prompt, pexels_query, motion_graphic`
            );
            stepData.output = { visuals: result.text };
            const cost = estimateCost(model, result.inputTokens, result.outputTokens);
            stepData.cost_cents = cost;
            totalCost += cost;
            await update<Project>("projects", project_id, {
              status: "producing",
              visual_data: { plan: result.text },
            } as unknown as Partial<Project>);
            break;
          }

          case "thumbnail_creation": {
            result = await callLLM(provider, model, key,
              "You are a YouTube thumbnail strategist. Design thumbnail concepts that maximize CTR. Remember: the actual text will be overlaid by Pillow, so DALL-E prompts must NOT contain any text.",
              `Design 2 thumbnail concepts for: "${project.topic}"\n\nFor each concept provide:\n- dalle_prompt: Image prompt (NO TEXT)\n- text_overlay: What text to overlay with Pillow\n- layout: Where elements go\n- color_scheme: Primary colors\n\nReturn as JSON array.`
            );
            stepData.output = { thumbnails: result.text };
            const cost = estimateCost(model, result.inputTokens, result.outputTokens);
            stepData.cost_cents = cost;
            totalCost += cost;
            break;
          }

          case "video_assembly": {
            stepData.output = {
              status: "ready_for_assembly",
              message: "All assets generated. Video assembly requires the worker service.",
            };
            break;
          }
        }

        stepData.duration_ms = Date.now() - startTime;
      } catch (error) {
        stepData.status = "failed";
        stepData.error = String(error);
        stepData.duration_ms = Date.now() - startTime;
        completedSteps.push(stepData);

        // Save progress and fail
        await update<Project>("projects", project_id, {
          status: "failed",
          total_cost_cents: totalCost,
          metadata: { ...project.metadata, pipeline_steps: completedSteps },
        } as unknown as Partial<Project>);

        return NextResponse.json({
          success: false,
          error: `Step "${stepName}" failed: ${String(error)}`,
          steps: completedSteps,
        });
      }

      completedSteps.push(stepData);

      // Save progress after each step
      await update<Project>("projects", project_id, {
        total_cost_cents: totalCost,
        metadata: { ...project.metadata, pipeline_steps: completedSteps },
      } as unknown as Partial<Project>);
    }

    // All steps complete
    await update<Project>("projects", project_id, {
      status: "completed",
      total_cost_cents: totalCost,
      metadata: { ...project.metadata, pipeline_steps: completedSteps },
    } as unknown as Partial<Project>);

    return NextResponse.json({
      success: true,
      data: { steps: completedSteps, total_cost_cents: totalCost },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
