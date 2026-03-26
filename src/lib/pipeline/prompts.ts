import type { Project, ChannelProfile, FormatPreset, PipelineStep, StepResult } from "@/types";

interface PromptContext {
  project: Project;
  profile?: ChannelProfile;
  format?: FormatPreset;
  previousSteps: StepResult[];
  settings: Record<string, string>;
}

interface PromptData {
  system: string;
  user: string;
  maxTokens: number;
}

function getPrevOutput(steps: StepResult[], stepName: PipelineStep): Record<string, unknown> | undefined {
  return steps.find((s) => s.step === stepName && s.status === "completed")?.output;
}

/**
 * Build the system + user prompt for a given pipeline step.
 * Returns null for non-LLM steps (voiceover, image gen, etc.)
 */
export function buildPrompt(step: PipelineStep, ctx: PromptContext): PromptData | null {
  switch (step) {
    case "topic_research":
      return {
        system: "You are a YouTube content researcher. Provide detailed research including key talking points, data, statistics, interesting facts, and audience hooks. Output as JSON with fields: talking_points (array of strings), statistics (array), key_facts (array), audience_hooks (array), competitor_angles (array).",
        user: `Research this topic thoroughly for a YouTube video: "${ctx.project.topic}"\n\nChannel niche: ${ctx.profile?.niche || "general"}\nTarget audience: ${ctx.profile?.target_audience || "general"}\nVoice style: ${ctx.profile?.voice_style || "professional"}`,
        maxTokens: 4096,
      };

    case "script_writing": {
      const research = (getPrevOutput(ctx.previousSteps, "topic_research") as { research?: string })?.research || "";
      const sections = ctx.format?.sections?.join(", ") || "hook, intro, body, conclusion, cta";
      const wordMin = ctx.format?.word_count_min || 900;
      const wordMax = ctx.format?.word_count_max || 1400;
      const wpm = ctx.format?.wpm || 145;
      const durMin = ctx.format?.duration_min ? Math.round(ctx.format.duration_min / 60) : 6;
      const durMax = ctx.format?.duration_max ? Math.round(ctx.format.duration_max / 60) : 10;
      return {
        system: `You are an expert YouTube scriptwriter for faceless channels. Write engaging, hook-driven scripts. CRITICAL RULES:\n- The voiceover MP3 is the production clock — word count drives runtime\n- MOTION_GRAPHIC tags are visual supplements ONLY — never replace narration\n- No text in DALL-E prompts — Pillow handles all text overlays\n- Format preset parameters drive content generation\n\nVoice style: ${ctx.profile?.voice_style || "professional"}`,
        user: `Write a full YouTube script for: "${ctx.project.topic}"\n\nResearch data:\n${research}\n\nFORMAT REQUIREMENTS:\n- Sections: ${sections}\n- Target word count: ${wordMin}-${wordMax} words\n- Target runtime: ${durMin}-${durMax} minutes at ${wpm} WPM\n- Include [VISUAL CUE: description] tags between sections describing what the viewer sees\n- Start with a strong hook (first 5 seconds)\n- End with a clear CTA\n\nOutput the complete narration script with section headers and [VISUAL CUE] tags.`,
        maxTokens: 4096,
      };
    }

    case "hook_engineering": {
      const script = (getPrevOutput(ctx.previousSteps, "script_writing") as { script?: string })?.script || "";
      return {
        system: "You are a viral hook specialist for YouTube. Generate 3 alternative hooks optimized for first-5-second retention. Each hook should use a different technique. Output as JSON array with fields: hook_text, technique (question/statistic/bold_claim/story/contradiction), why_it_works, estimated_retention_boost_percent.",
        user: `Generate 3 viral hooks for: "${ctx.project.topic}"\n\nCurrent script opening:\n${script.slice(0, 800)}\n\nChannel voice: ${ctx.profile?.voice_style || "professional"}\nTarget audience: ${ctx.profile?.target_audience || "general"}`,
        maxTokens: 4096,
      };
    }

    case "voice_selection": {
      const script = (getPrevOutput(ctx.previousSteps, "script_writing") as { script?: string })?.script || "";
      return {
        system: "You are a voice casting director for YouTube narration. Analyze the script mood and recommend voice parameters. Output as JSON with fields: recommended_pace (words_per_minute), tone (warm/authoritative/energetic/mysterious/casual), emphasis_markers (array of {text, style}), pause_points (array of {after_text, duration_seconds}), overall_energy (1-10).",
        user: `Analyze this script and recommend voice parameters:\n\n${script.slice(0, 2000)}\n\nChannel voice style: ${ctx.profile?.voice_style || "professional"}\nExisting voice ID: ${ctx.profile?.voice_id || "none"}`,
        maxTokens: 4096,
      };
    }

    case "visual_direction": {
      const script = (getPrevOutput(ctx.previousSteps, "script_writing") as { script?: string })?.script || "";
      return {
        system: "You are a visual director for faceless YouTube videos. Create a visual plan with DALL-E image prompts and Pexels search queries for each script section. CRITICAL: Never include text in DALL-E prompts — all text overlays are handled by Pillow in post-production. MOTION_GRAPHIC tags are visual supplements only. Output as JSON with fields: scenes (array of {section, timestamp_approx, dalle_prompt, pexels_query, motion_graphic_overlay, duration_seconds}).",
        user: `Create visual direction for this script:\n\n${script.slice(0, 3000)}\n\nChannel niche: ${ctx.profile?.niche || "general"}\nBrand colors: ${ctx.profile?.brand_colors?.join(", ") || "none specified"}`,
        maxTokens: 4096,
      };
    }

    case "blend_curator": {
      const visuals = (getPrevOutput(ctx.previousSteps, "visual_direction") as { visuals?: string })?.visuals || "";
      return {
        system: "You are a B-roll curation specialist. For each scene, decide the optimal blend of AI-generated imagery vs stock footage vs motion graphics. Output as JSON array with fields: scene_id, primary_source (dalle/pexels/motion_graphic), secondary_source, blend_ratio, pexels_search_queries (array), transition_type (cut/dissolve/zoom/slide).",
        user: `Curate the visual blend for this video:\n\nVisual direction:\n${visuals.slice(0, 3000)}\n\nOptimize for engagement and visual variety.`,
        maxTokens: 4096,
      };
    }

    case "brand_assets":
      return {
        system: "You are a brand identity designer for YouTube channels. Define brand-consistent visual assets. Output as JSON with fields: color_palette (array of {name, hex, usage}), lower_third_style (object), intro_template (object), outro_template (object), watermark_spec (object), font_recommendations (array), channel_logo_description (string).",
        user: `Design brand assets for channel "${ctx.profile?.name || "channel"}":\n\nNiche: ${ctx.profile?.niche || "general"}\nVoice style: ${ctx.profile?.voice_style || "professional"}\nExisting brand colors: ${ctx.profile?.brand_colors?.join(", ") || "none — suggest new ones"}\nTarget audience: ${ctx.profile?.target_audience || "general"}`,
        maxTokens: 4096,
      };

    case "script_refinement": {
      const script = (getPrevOutput(ctx.previousSteps, "script_writing") as { script?: string })?.script || "";
      const hooks = (getPrevOutput(ctx.previousSteps, "hook_engineering") as { hooks?: string })?.hooks || "";
      return {
        system: "You are a YouTube script editor. Refine the script for maximum engagement, clarity, and retention. Integrate the best hook from the alternatives. Ensure smooth transitions, eliminate filler, strengthen the narrative arc, and verify word count stays in target range. Output the complete refined script.",
        user: `Refine this script:\n\n${script}\n\nAlternative hooks to consider:\n${hooks}\n\nRequirements:\n- Integrate the strongest hook\n- Strengthen all transitions\n- Eliminate filler words\n- Keep [VISUAL CUE] tags\n- Maintain target word count\n\nOutput the complete refined script.`,
        maxTokens: 4096,
      };
    }

    case "timing_sync": {
      const script = (getPrevOutput(ctx.previousSteps, "script_refinement") as { refined_script?: string })?.refined_script || "";
      const visuals = (getPrevOutput(ctx.previousSteps, "visual_direction") as { visuals?: string })?.visuals || "";
      const blend = (getPrevOutput(ctx.previousSteps, "blend_curator") as { blend_plan?: string })?.blend_plan || "";
      const wpm = ctx.format?.wpm || 145;
      return {
        system: `You are a video timing engineer. Map each scene to precise timestamps based on word count and WPM. The voiceover MP3 is the production clock.

CRITICAL: Output as a JSON array where each entry has EXACTLY these fields:
- scene (integer, starting from 1)
- tag_type (one of: "DALLE", "RUNWAY", "STOCK", "MOTION_GRAPHIC" — based on the blend curator's primary_source for that scene)
- duration (number, seconds — derived from word count / WPM)
- label (string — section name from the script)
- start_time_seconds (number)
- end_time_seconds (number)
- transition_in (string: "fade", "cut", "dissolve")
- transition_out (string: "fade", "cut", "dissolve")
- notes (string — timing notes for the editor)

Include a final entry for the End Card (tag_type: "MOTION_GRAPHIC", duration: 12, label: "End Card").
Duration of each scene is derived from the word count of that section at the given WPM.`,
        user: `Create timing sync for this production:\n\nNarration WPM: ${wpm}\n\nRefined script:\n${script.slice(0, 3000)}\n\nVisual direction plan:\n${visuals.slice(0, 1500)}\n\nBlend curator plan (determines tag_type per scene):\n${blend.slice(0, 1500)}`,
        maxTokens: 4096,
      };
    }

    case "thumbnail_creation": {
      const brand = (getPrevOutput(ctx.previousSteps, "brand_assets") as { brand?: string })?.brand || "";
      return {
        system: "You are a YouTube thumbnail strategist. Design thumbnail concepts that maximize CTR. CRITICAL: DALL-E prompts must NOT contain any text — Pillow handles text overlays in post-production. Output as JSON array with fields: concept_name, dalle_prompt (NO TEXT), text_overlay (what Pillow adds), text_position, text_style, color_scheme, emotion_target, estimated_ctr_boost.",
        user: `Design 3 thumbnail concepts for: "${ctx.project.topic}"\n\nBrand guidelines:\n${brand.slice(0, 1000)}\nChannel niche: ${ctx.profile?.niche || "general"}`,
        maxTokens: 4096,
      };
    }

    case "retention_structure": {
      const script = (getPrevOutput(ctx.previousSteps, "script_refinement") as { refined_script?: string })?.refined_script || "";
      const timing = (getPrevOutput(ctx.previousSteps, "timing_sync") as { timing?: string })?.timing || "";
      return {
        system: "You are a YouTube retention optimization specialist. Insert pattern interrupts, curiosity loops, and re-hook points. Output as JSON with fields: retention_events (array of {timestamp_seconds, type (pattern_interrupt/curiosity_loop/rehook/payoff), description, visual_change}), predicted_retention_curve (array of {percent_through, estimated_retention_pct}), risk_points (array of {timestamp, risk, mitigation}).",
        user: `Optimize retention for this video:\n\nScript:\n${script.slice(0, 2000)}\n\nTiming:\n${timing.slice(0, 1500)}`,
        maxTokens: 4096,
      };
    }

    case "comment_magnet": {
      const script = (getPrevOutput(ctx.previousSteps, "script_refinement") as { refined_script?: string })?.refined_script || "";
      return {
        system: "You are a YouTube engagement specialist. Generate content designed to drive comments and interaction. Output as JSON with fields: pinned_comment (string), in_video_questions (array of {timestamp_approx, question, placement}), poll_suggestion (object), community_post_teaser (string), end_screen_cta (string).",
        user: `Generate engagement prompts for: "${ctx.project.topic}"\n\nScript excerpt:\n${script.slice(0, 1500)}\n\nTarget audience: ${ctx.profile?.target_audience || "general"}`,
        maxTokens: 4096,
      };
    }

    case "upload_blueprint": {
      const script = (getPrevOutput(ctx.previousSteps, "script_refinement") as { refined_script?: string })?.refined_script || "";
      const thumbnails = (getPrevOutput(ctx.previousSteps, "thumbnail_creation") as { thumbnails?: string })?.thumbnails || "";
      return {
        system: "You are a YouTube SEO and upload optimization specialist. Create a complete upload blueprint. Output as JSON with fields: title (under 60 chars, SEO-optimized), description (with timestamps, links, keywords), tags (array of 15-20 tags), category, default_language, end_screen_elements (array), cards (array of {timestamp, type, text}), scheduled_publish_time_suggestion, hashtags (array of 3).",
        user: `Create upload blueprint for: "${ctx.project.topic}"\n\nScript:\n${script.slice(0, 1500)}\n\nThumbnail concepts:\n${thumbnails.slice(0, 500)}\n\nChannel niche: ${ctx.profile?.niche || "general"}`,
        maxTokens: 4096,
      };
    }

    // Non-LLM steps
    default:
      return null;
  }
}

// ─── Output key mapping per step ───

const OUTPUT_KEYS: Record<string, string> = {
  topic_research: "research",
  script_writing: "script",
  hook_engineering: "hooks",
  voice_selection: "voice_params",
  visual_direction: "visuals",
  blend_curator: "blend_plan",
  brand_assets: "brand",
  script_refinement: "refined_script",
  timing_sync: "timing",
  thumbnail_creation: "thumbnails",
  retention_structure: "retention",
  comment_magnet: "engagement",
  upload_blueprint: "upload",
};

const PROJECT_UPDATE_STEPS: Record<string, (text: string, prevScript?: string) => Record<string, unknown>> = {
  script_writing: (text) => ({ script_data: { raw: text } }),
  visual_direction: (text) => ({ visual_data: { plan: text } }),
  script_refinement: (text) => ({ script_data: { refined: text } }),
};

/**
 * Build the save payload from LLM result text.
 */
export function buildSaveData(
  step: PipelineStep,
  text: string,
  inputTokens: number,
  outputTokens: number,
  model: string
): {
  output: Record<string, unknown>;
  cost_cents: number;
  projectUpdates?: Partial<Project>;
} {
  const outputKey = OUTPUT_KEYS[step] || step;
  const output: Record<string, unknown> = { [outputKey]: text };

  // Cost estimation
  const pricing: Record<string, { input: number; output: number }> = {
    "claude-sonnet-4-6": { input: 300, output: 1500 },
    "claude-opus-4-6": { input: 1500, output: 7500 },
    "claude-haiku-4-5-20251001": { input: 80, output: 400 },
    "gpt-4o": { input: 250, output: 1000 },
    "gpt-4o-mini": { input: 15, output: 60 },
  };
  const p = pricing[model] || pricing["claude-sonnet-4-6"];
  const cost_cents = Math.ceil((inputTokens * p.input + outputTokens * p.output) / 1_000_000);

  const projectUpdates = PROJECT_UPDATE_STEPS[step]
    ? PROJECT_UPDATE_STEPS[step](text) as Partial<Project>
    : undefined;

  return { output, cost_cents, projectUpdates };
}
