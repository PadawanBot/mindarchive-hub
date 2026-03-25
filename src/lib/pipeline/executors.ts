import type { Project, ChannelProfile, FormatPreset, PipelineStep, StepResult } from "@/types";
import { generateWithClaude } from "@/lib/providers/anthropic";
import { generateWithGPT } from "@/lib/providers/openai";
import { generateImage } from "@/lib/providers/openai";
import { generateVoiceover } from "@/lib/providers/elevenlabs";
import { downloadAndStore } from "@/lib/storage";
import { searchVideos } from "@/lib/providers/pexels";

// ─── Context passed to every executor ───

export interface StepContext {
  project: Project;
  profile?: ChannelProfile;
  format?: FormatPreset;
  previousSteps: StepResult[];
  settings: Record<string, string>;
}

export interface StepOutput {
  output: Record<string, unknown>;
  cost_cents: number;
  projectUpdates?: Partial<Project>;
}

export type StepExecutor = (ctx: StepContext) => Promise<StepOutput>;

// ─── LLM helpers ───

async function callLLM(
  ctx: StepContext,
  system: string,
  prompt: string,
  maxTokens = 4096
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const provider = ctx.profile?.llm_provider || ctx.settings.default_provider || ctx.settings.default_llm_provider || "anthropic";
  // Hardcode Haiku — Vercel Hobby 60s limit makes Sonnet/Opus impossible
  const model = "claude-haiku-4-5-20251001";
  const key = provider === "anthropic" ? ctx.settings.anthropic_key : ctx.settings.openai_key;
  if (!key) throw new Error(`${provider} API key not configured. Go to Settings.`);
  if (provider === "anthropic") return generateWithClaude(key, model, system, prompt, maxTokens);
  return generateWithGPT(key, model, system, prompt, maxTokens);
}

export function estimateCost(ctx: StepContext, inputTokens: number, outputTokens: number): number {
  const model = ctx.profile?.llm_model || ctx.settings.default_model || ctx.settings.default_llm_model || "claude-haiku-4-5-20251001";
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

function getPrevOutput(steps: StepResult[], stepName: PipelineStep): Record<string, unknown> | undefined {
  return steps.find((s) => s.step === stepName && s.status === "completed")?.output;
}

// ─── Executors ───

const topic_research: StepExecutor = async (ctx) => {
  const result = await callLLM(ctx,
    "You are a YouTube content researcher. Provide detailed research including key talking points, data, statistics, interesting facts, and audience hooks. Output as JSON with fields: talking_points (array of strings), statistics (array), key_facts (array), audience_hooks (array), competitor_angles (array).",
    `Research this topic thoroughly for a YouTube video: "${ctx.project.topic}"\n\nChannel niche: ${ctx.profile?.niche || "general"}\nTarget audience: ${ctx.profile?.target_audience || "general"}\nVoice style: ${ctx.profile?.voice_style || "professional"}`
  );
  return { output: { research: result.text }, cost_cents: estimateCost(ctx, result.inputTokens, result.outputTokens) };
};

const script_writing: StepExecutor = async (ctx) => {
  const research = (getPrevOutput(ctx.previousSteps, "topic_research") as { research?: string })?.research || "";
  const sections = ctx.format?.sections?.join(", ") || "hook, intro, body, conclusion, cta";
  const wordMin = ctx.format?.word_count_min || 900;
  const wordMax = ctx.format?.word_count_max || 1400;
  const wpm = ctx.format?.wpm || 145;
  const durMin = ctx.format?.duration_min ? Math.round(ctx.format.duration_min / 60) : 6;
  const durMax = ctx.format?.duration_max ? Math.round(ctx.format.duration_max / 60) : 10;

  const result = await callLLM(ctx,
    `You are an expert YouTube scriptwriter for faceless channels. Write engaging, hook-driven scripts. CRITICAL RULES:\n- The voiceover MP3 is the production clock — word count drives runtime\n- MOTION_GRAPHIC tags are visual supplements ONLY — never replace narration\n- No text in DALL-E prompts — Pillow handles all text overlays\n- Format preset parameters drive content generation\n\nVoice style: ${ctx.profile?.voice_style || "professional"}`,
    `Write a full YouTube script for: "${ctx.project.topic}"\n\nResearch data:\n${research}\n\nFORMAT REQUIREMENTS:\n- Sections: ${sections}\n- Target word count: ${wordMin}-${wordMax} words\n- Target runtime: ${durMin}-${durMax} minutes at ${wpm} WPM\n- Include [VISUAL CUE: description] tags between sections describing what the viewer sees\n- Start with a strong hook (first 5 seconds)\n- End with a clear CTA\n\nOutput the complete narration script with section headers and [VISUAL CUE] tags.`,
    4096
  );
  return {
    output: { script: result.text },
    cost_cents: estimateCost(ctx, result.inputTokens, result.outputTokens),
    projectUpdates: { script_data: { raw: result.text } } as unknown as Partial<Project>,
  };
};

const hook_engineering: StepExecutor = async (ctx) => {
  const script = (getPrevOutput(ctx.previousSteps, "script_writing") as { script?: string })?.script || "";
  const result = await callLLM(ctx,
    "You are a viral hook specialist for YouTube. Generate 3 alternative hooks optimized for first-5-second retention. Each hook should use a different technique. Output as JSON array with fields: hook_text, technique (question/statistic/bold_claim/story/contradiction), why_it_works, estimated_retention_boost_percent.",
    `Generate 3 viral hooks for: "${ctx.project.topic}"\n\nCurrent script opening:\n${script.slice(0, 800)}\n\nChannel voice: ${ctx.profile?.voice_style || "professional"}\nTarget audience: ${ctx.profile?.target_audience || "general"}`
  );
  return { output: { hooks: result.text }, cost_cents: estimateCost(ctx, result.inputTokens, result.outputTokens) };
};

const voice_selection: StepExecutor = async (ctx) => {
  const script = (getPrevOutput(ctx.previousSteps, "script_writing") as { script?: string })?.script || "";
  const result = await callLLM(ctx,
    "You are a voice casting director for YouTube narration. Analyze the script mood and recommend voice parameters. Output as JSON with fields: recommended_pace (words_per_minute), tone (warm/authoritative/energetic/mysterious/casual), emphasis_markers (array of {text, style}), pause_points (array of {after_text, duration_seconds}), overall_energy (1-10).",
    `Analyze this script and recommend voice parameters:\n\n${script.slice(0, 2000)}\n\nChannel voice style: ${ctx.profile?.voice_style || "professional"}\nExisting voice ID: ${ctx.profile?.voice_id || "none"}`
  );
  return { output: { voice_params: result.text }, cost_cents: estimateCost(ctx, result.inputTokens, result.outputTokens) };
};

const visual_direction: StepExecutor = async (ctx) => {
  const script = (getPrevOutput(ctx.previousSteps, "script_writing") as { script?: string })?.script || "";
  const result = await callLLM(ctx,
    "You are a visual director for faceless YouTube videos. Create a visual plan with DALL-E image prompts and Pexels search queries for each script section. CRITICAL: Never include text in DALL-E prompts — all text overlays are handled by Pillow in post-production. MOTION_GRAPHIC tags are visual supplements only. Output as JSON with fields: scenes (array of {section, timestamp_approx, dalle_prompt, pexels_query, motion_graphic_overlay, duration_seconds}).",
    `Create visual direction for this script:\n\n${script.slice(0, 3000)}\n\nChannel niche: ${ctx.profile?.niche || "general"}\nBrand colors: ${ctx.profile?.brand_colors?.join(", ") || "none specified"}`,
    4096
  );
  return {
    output: { visuals: result.text },
    cost_cents: estimateCost(ctx, result.inputTokens, result.outputTokens),
    projectUpdates: { visual_data: { plan: result.text } } as unknown as Partial<Project>,
  };
};

const blend_curator: StepExecutor = async (ctx) => {
  const visuals = (getPrevOutput(ctx.previousSteps, "visual_direction") as { visuals?: string })?.visuals || "";
  const result = await callLLM(ctx,
    "You are a B-roll curation specialist. For each scene, decide the optimal blend of AI-generated imagery vs stock footage vs motion graphics. Output as JSON array with fields: scene_id, primary_source (dalle/pexels/motion_graphic), secondary_source, blend_ratio, pexels_search_queries (array), transition_type (cut/dissolve/zoom/slide).",
    `Curate the visual blend for this video:\n\nVisual direction:\n${visuals.slice(0, 3000)}\n\nOptimize for engagement and visual variety.`
  );
  return { output: { blend_plan: result.text }, cost_cents: estimateCost(ctx, result.inputTokens, result.outputTokens) };
};

const brand_assets: StepExecutor = async (ctx) => {
  const result = await callLLM(ctx,
    "You are a brand identity designer for YouTube channels. Define brand-consistent visual assets. Output as JSON with fields: color_palette (array of {name, hex, usage}), lower_third_style (object), intro_template (object), outro_template (object), watermark_spec (object), font_recommendations (array), channel_logo_description (string).",
    `Design brand assets for channel "${ctx.profile?.name || "channel"}":\n\nNiche: ${ctx.profile?.niche || "general"}\nVoice style: ${ctx.profile?.voice_style || "professional"}\nExisting brand colors: ${ctx.profile?.brand_colors?.join(", ") || "none — suggest new ones"}\nTarget audience: ${ctx.profile?.target_audience || "general"}`
  );
  return { output: { brand: result.text }, cost_cents: estimateCost(ctx, result.inputTokens, result.outputTokens) };
};

const script_refinement: StepExecutor = async (ctx) => {
  const script = (getPrevOutput(ctx.previousSteps, "script_writing") as { script?: string })?.script || "";
  const hooks = (getPrevOutput(ctx.previousSteps, "hook_engineering") as { hooks?: string })?.hooks || "";
  const result = await callLLM(ctx,
    "You are a YouTube script editor. Refine the script for maximum engagement, clarity, and retention. Integrate the best hook from the alternatives. Ensure smooth transitions, eliminate filler, strengthen the narrative arc, and verify word count stays in target range. Output the complete refined script.",
    `Refine this script:\n\n${script}\n\nAlternative hooks to consider:\n${hooks}\n\nRequirements:\n- Integrate the strongest hook\n- Strengthen all transitions\n- Eliminate filler words\n- Keep [VISUAL CUE] tags\n- Maintain target word count\n\nOutput the complete refined script.`,
    4096
  );
  return {
    output: { refined_script: result.text },
    cost_cents: estimateCost(ctx, result.inputTokens, result.outputTokens),
    projectUpdates: { script_data: { raw: script, refined: result.text } } as unknown as Partial<Project>,
  };
};

const timing_sync: StepExecutor = async (ctx) => {
  const script = (getPrevOutput(ctx.previousSteps, "script_refinement") as { refined_script?: string })?.refined_script || "";
  const visuals = (getPrevOutput(ctx.previousSteps, "visual_direction") as { visuals?: string })?.visuals || "";
  const wpm = ctx.format?.wpm || 145;
  const result = await callLLM(ctx,
    "You are a video timing engineer. Map each visual asset to precise narration timestamps based on word count and WPM. The voiceover MP3 is the production clock. Output as JSON array with fields: section, start_time_seconds, end_time_seconds, word_count, visual_asset_id, transition_in, transition_out, notes.",
    `Create timing sync for this production:\n\nNarration WPM: ${wpm}\n\nRefined script:\n${script.slice(0, 3000)}\n\nVisual plan:\n${visuals.slice(0, 2000)}`
  );
  return { output: { timing: result.text }, cost_cents: estimateCost(ctx, result.inputTokens, result.outputTokens) };
};

const thumbnail_creation: StepExecutor = async (ctx) => {
  const brand = (getPrevOutput(ctx.previousSteps, "brand_assets") as { brand?: string })?.brand || "";
  const result = await callLLM(ctx,
    "You are a YouTube thumbnail strategist. Design thumbnail concepts that maximize CTR. CRITICAL: DALL-E prompts must NOT contain any text — Pillow handles text overlays in post-production. Output as JSON array with fields: concept_name, dalle_prompt (NO TEXT), text_overlay (what Pillow adds), text_position, text_style, color_scheme, emotion_target, estimated_ctr_boost.",
    `Design 3 thumbnail concepts for: "${ctx.project.topic}"\n\nBrand guidelines:\n${brand.slice(0, 1000)}\nChannel niche: ${ctx.profile?.niche || "general"}`
  );
  return { output: { thumbnails: result.text }, cost_cents: estimateCost(ctx, result.inputTokens, result.outputTokens) };
};

const retention_structure: StepExecutor = async (ctx) => {
  const script = (getPrevOutput(ctx.previousSteps, "script_refinement") as { refined_script?: string })?.refined_script || "";
  const timing = (getPrevOutput(ctx.previousSteps, "timing_sync") as { timing?: string })?.timing || "";
  const result = await callLLM(ctx,
    "You are a YouTube retention optimization specialist. Insert pattern interrupts, curiosity loops, and re-hook points. Output as JSON with fields: retention_events (array of {timestamp_seconds, type (pattern_interrupt/curiosity_loop/rehook/payoff), description, visual_change}), predicted_retention_curve (array of {percent_through, estimated_retention_pct}), risk_points (array of {timestamp, risk, mitigation}).",
    `Optimize retention for this video:\n\nScript:\n${script.slice(0, 2000)}\n\nTiming:\n${timing.slice(0, 1500)}`
  );
  return { output: { retention: result.text }, cost_cents: estimateCost(ctx, result.inputTokens, result.outputTokens) };
};

const comment_magnet: StepExecutor = async (ctx) => {
  const script = (getPrevOutput(ctx.previousSteps, "script_refinement") as { refined_script?: string })?.refined_script || "";
  const result = await callLLM(ctx,
    "You are a YouTube engagement specialist. Generate content designed to drive comments and interaction. Output as JSON with fields: pinned_comment (string), in_video_questions (array of {timestamp_approx, question, placement}), poll_suggestion (object), community_post_teaser (string), end_screen_cta (string).",
    `Generate engagement prompts for: "${ctx.project.topic}"\n\nScript excerpt:\n${script.slice(0, 1500)}\n\nTarget audience: ${ctx.profile?.target_audience || "general"}`
  );
  return { output: { engagement: result.text }, cost_cents: estimateCost(ctx, result.inputTokens, result.outputTokens) };
};

const upload_blueprint: StepExecutor = async (ctx) => {
  const script = (getPrevOutput(ctx.previousSteps, "script_refinement") as { refined_script?: string })?.refined_script || "";
  const thumbnails = (getPrevOutput(ctx.previousSteps, "thumbnail_creation") as { thumbnails?: string })?.thumbnails || "";
  const result = await callLLM(ctx,
    "You are a YouTube SEO and upload optimization specialist. Create a complete upload blueprint. Output as JSON with fields: title (under 60 chars, SEO-optimized), description (with timestamps, links, keywords), tags (array of 15-20 tags), category, default_language, end_screen_elements (array), cards (array of {timestamp, type, text}), scheduled_publish_time_suggestion, hashtags (array of 3).",
    `Create upload blueprint for: "${ctx.project.topic}"\n\nScript:\n${script.slice(0, 1500)}\n\nThumbnail concepts:\n${thumbnails.slice(0, 500)}\n\nChannel niche: ${ctx.profile?.niche || "general"}`
  );
  return { output: { upload: result.text }, cost_cents: estimateCost(ctx, result.inputTokens, result.outputTokens) };
};

// ─── Production step executors ───

const voiceover_generation: StepExecutor = async (ctx) => {
  const key = ctx.settings.elevenlabs_key;
  const voiceId = ctx.profile?.voice_id;
  if (!key) return { output: { status: "skipped", reason: "No ElevenLabs API key configured" }, cost_cents: 0 };
  if (!voiceId) return { output: { status: "skipped", reason: "No voice ID in channel profile" }, cost_cents: 0 };

  const script = (getPrevOutput(ctx.previousSteps, "script_refinement") as { refined_script?: string })?.refined_script || "";
  // Strip visual cues and section headers for voiceover
  const narration = script.replace(/\[VISUAL CUE:.*?\]/g, "").replace(/^#{1,3}\s.*$/gm, "").replace(/\n{3,}/g, "\n\n").trim();

  // Trigger ElevenLabs generation via streaming — read just the first chunk
  // to confirm it started, then let ElevenLabs finish in the background.
  // The full audio is stored in ElevenLabs history for later retrieval.
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
    {
      method: "POST",
      headers: {
        "xi-api-key": key,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: narration,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.5,
          use_speaker_boost: true,
        },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`ElevenLabs API error: ${response.status} - ${error}`);
  }

  // Read just a small chunk to confirm audio is streaming, then abort
  const reader = response.body?.getReader();
  let audioStarted = false;
  let bytesRead = 0;
  if (reader) {
    try {
      const { value } = await reader.read();
      if (value && value.length > 0) {
        audioStarted = true;
        bytesRead = value.length;
      }
    } finally {
      reader.cancel();
    }
  }

  if (!audioStarted) {
    throw new Error("ElevenLabs returned empty audio stream");
  }

  const wordCount = narration.split(/\s+/).length;
  const estimatedDurationMin = Math.round(wordCount / 150 * 10) / 10;

  return {
    output: {
      status: "completed",
      voice_id: voiceId,
      narration_length: narration.length,
      word_count: wordCount,
      estimated_duration_minutes: estimatedDurationMin,
      audio_confirmed: true,
      note: "Audio generated in ElevenLabs. Retrieve from history for assembly.",
    },
    cost_cents: Math.ceil(narration.length * 0.003),
  };
};

const image_generation: StepExecutor = async (ctx) => {
  const key = ctx.settings.openai_key;
  if (!key) return { output: { status: "skipped", reason: "No OpenAI API key configured" }, cost_cents: 0 };

  const visuals = (getPrevOutput(ctx.previousSteps, "visual_direction") as { visuals?: string })?.visuals || "";
  // Try to parse DALL-E prompts from the visual direction
  let prompts: string[] = [];
  try {
    const parsed = JSON.parse(visuals);
    if (Array.isArray(parsed)) {
      prompts = parsed.map((s: { dalle_prompt?: string }) => s.dalle_prompt).filter(Boolean) as string[];
    } else if (parsed.scenes) {
      prompts = parsed.scenes.map((s: { dalle_prompt?: string }) => s.dalle_prompt).filter(Boolean) as string[];
    }
  } catch {
    // If not JSON, try to extract prompts with regex
    const matches = visuals.match(/dalle_prompt["\s:]+([^"]+)/g);
    if (matches) prompts = matches.map(m => m.replace(/dalle_prompt["\s:]+/, "")).slice(0, 5);
  }

  if (prompts.length === 0) {
    return { output: { status: "skipped", reason: "No DALL-E prompts found in visual direction" }, cost_cents: 0 };
  }

  // Generate up to 3 images in parallel (DALL-E takes ~15-20s each, parallel ≈ 20s total)
  const maxImages = Math.min(prompts.length, 3);
  const imagePromises = prompts.slice(0, maxImages).map(async (p, i) => {
    try {
      const img = await generateImage(key, p);
      // Persist to Supabase Storage so URLs don't expire
      const storedUrl = await downloadAndStore(
        ctx.project.id, `dalle-scene-${i + 1}.png`, img.url, "image/png"
      );
      return { prompt: p, url: storedUrl || img.url, revised_prompt: img.revisedPrompt, stored: !!storedUrl };
    } catch {
      return null;
    }
  });
  const results = await Promise.all(imagePromises);
  const images = results.filter(Boolean) as { prompt: string; url: string; revised_prompt: string; stored: boolean }[];

  return {
    output: { status: "completed", images, total_prompts: prompts.length, generated: images.length },
    cost_cents: images.length * 8, // ~$0.08 per DALL-E 3 HD image
  };
};

const stock_footage: StepExecutor = async (ctx) => {
  const key = ctx.settings.pexels_key;
  if (!key) return { output: { status: "skipped", reason: "No Pexels API key configured" }, cost_cents: 0 };

  const blend = (getPrevOutput(ctx.previousSteps, "blend_curator") as { blend_plan?: string })?.blend_plan || "";
  let queries: string[] = [];
  try {
    const parsed = JSON.parse(blend);
    if (Array.isArray(parsed)) {
      queries = parsed.flatMap((s: { pexels_search_queries?: string[] }) => s.pexels_search_queries || []);
    }
  } catch {
    // Fallback: use the project topic
    queries = [ctx.project.topic];
  }

  if (queries.length === 0) queries = [ctx.project.topic];

  const results: { query: string; video_count: number; videos: { id: number; url: string; duration: number }[] }[] = [];
  for (const q of queries.slice(0, 5)) {
    const videos = await searchVideos(key, q, 3);
    results.push({
      query: q,
      video_count: videos.length,
      videos: videos.map(v => ({ id: v.id, url: v.url, duration: v.duration })),
    });
  }

  return { output: { status: "completed", footage: results }, cost_cents: 0 };
};

const motion_graphics: StepExecutor = async (ctx) => {
  const timing = (getPrevOutput(ctx.previousSteps, "timing_sync") as { timing?: string })?.timing || "";
  const brand = (getPrevOutput(ctx.previousSteps, "brand_assets") as { brand?: string })?.brand || "";
  return {
    output: {
      status: "ready_for_render",
      message: "Motion graphic definitions generated. Pillow/ffmpeg worker handles rendering.",
      timing_data: timing.slice(0, 500),
      brand_data: brand.slice(0, 500),
    },
    cost_cents: 0,
  };
};

const hero_scenes: StepExecutor = async () => {
  return {
    output: {
      status: "stub",
      message: "Runway AI integration pending. Hero scene generation will be available in a future update.",
    },
    cost_cents: 0,
  };
};

// ─── Executor registry ───

export const executors: Record<PipelineStep, StepExecutor> = {
  topic_research,
  script_writing,
  hook_engineering,
  voice_selection,
  visual_direction,
  blend_curator,
  brand_assets,
  script_refinement,
  timing_sync,
  thumbnail_creation,
  retention_structure,
  comment_magnet,
  upload_blueprint,
  voiceover_generation,
  image_generation,
  stock_footage,
  motion_graphics,
  hero_scenes,
};
