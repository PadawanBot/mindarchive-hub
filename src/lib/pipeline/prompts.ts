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
        system: `You are an expert YouTube scriptwriter for faceless documentary channels. Write engaging, hook-driven scripts in the style of a Netflix episode.

VISUAL TAG SYSTEM — after each paragraph of narration, add ONE visual tag on a new line:
[DALLE: <cinematic still image — photorealistic, 4K documentary style, no text in frame>]
[RUNWAY: <5-10s motion video — hero/peak emotional moment only, max 3-5 total per video>]
[STOCK: <2-3 keyword search terms for real-world footage>]
[MOTION_GRAPHIC: <text or data content to display as a card>]

Use [DALLE] as the default for most scenes. Use [RUNWAY] ONLY for the most cinematic emotional peaks (max 3-5 per video). Use [STOCK] for real-world footage, environments, archival scenes. Use [MOTION_GRAPHIC] for statistics, titles, labels, checklists — any text on screen.

CRITICAL RULES:
- The voiceover MP3 is the production clock — word count drives runtime
- [MOTION_GRAPHIC] is a VISUAL SUPPLEMENT only — never replaces narration. Every data point, checklist item, and tactic MUST be fully narrated. The card reinforces narration, not replaces it.
- Never put text in DALLE prompts — Pillow handles all text overlays
- DALLE style: "cinematic, photorealistic, 4K documentary style, no text in frame"
- Include a cold open that hooks in 7 seconds
- 3-act structure with emotional arc (curiosity, conflict, payoff)

Voice style: ${ctx.profile?.voice_style || "professional"}`,
        user: `Write a YouTube documentary script about: "${ctx.project.topic}"

Research data:
${research}

FORMAT REQUIREMENTS:
- Sections: ${sections}
- Target word count: ${wordMin}-${wordMax} words
- Target runtime: ${durMin}-${durMax} minutes at ${wpm} WPM
- Each paragraph = one visual scene with a visual tag on the next line
- Start with a strong hook (first 7 seconds)
- End with a clear CTA

Output the complete narration script with visual tags after each paragraph.`,
        maxTokens: 8192,
      };
    }

    case "hook_engineering": {
      const script = (getPrevOutput(ctx.previousSteps, "script_writing") as { script?: string })?.script || "";
      return {
        system: `You are a viral hook specialist for YouTube. Generate 10 viral hooks that:
- Trigger curiosity gaps
- Use power words like "before", "exposed", "the last time"
- Work as both voiceover and thumbnail text
- Fit under 100 characters
- Have pattern-break potential

Output as JSON array with fields: hook_text, technique (question/statistic/bold_claim/story/contradiction), why_it_works, estimated_retention_boost_percent.
Rank by emotional intensity — Hook #1 should be the strongest cold open candidate.`,
        user: `Generate 10 viral hooks for: "${ctx.project.topic}"\n\nCurrent script opening:\n${script.slice(0, 800)}\n\nChannel voice: ${ctx.profile?.voice_style || "professional"}\nTarget audience: ${ctx.profile?.target_audience || "general"}`,
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
      const script = (getPrevOutput(ctx.previousSteps, "script_refinement") as { refined_script?: string })?.refined_script
        || (getPrevOutput(ctx.previousSteps, "script_writing") as { script?: string })?.script || "";
      return {
        system: `You are a visual director for faceless YouTube documentary videos. For each scene/paragraph in the script, generate detailed visual direction and a production spec.

For each scene, describe:
- Environment, time of day, tone
- Camera angle, lighting, composition
- Colour grade direction
- Style reference (cinematic, documentary, stylized realism)

Then assign ONE tag_type per scene and provide the matching production spec:
- "DALLE": DALL-E 3 prompt — MUST end with "cinematic, photorealistic, 4K documentary style, no text in frame". Include Ken Burns direction (zoom amount like 1.04-1.08, duration, pan direction).
- "RUNWAY": Runway Gen-3 motion prompt — 5-10 seconds, cinematic movement. Include motion_type (push-in, dolly, pull-back, tracking). Max 3-5 RUNWAY scenes per video — use only for peak emotional/cinematic moments.
- "STOCK": search_keywords field — 2-3 Pexels keywords for real-world footage (nature, cities, people, abstract — NO fictional characters or anime terms).
- "MOTION_GRAPHIC": text_content + layout_type (title_card / list_card / checklist / end_card) + colour_scheme with hex values. Use for titles, statistics, checklists, end cards.

Distribution: ~60% DALLE (default), ~15% RUNWAY (emotional peaks only), ~10% STOCK (real-world B-roll), ~15% MOTION_GRAPHIC (titles/data/end card).

Output as a JSON array. Each entry has:
- scene (int), tag_type, visual_direction (scene description), prompt/search_keywords/text_content (depending on tag_type)
- duration (seconds), transition_in, transition_out
- ken_burns (for DALLE), motion_type (for RUNWAY), layout_type + colour_scheme (for MOTION_GRAPHIC)

Complete ALL scenes in the script. Do not stop early.`,
        user: `Create visual direction for this script:\n\n${script.slice(0, 6000)}\n\nChannel niche: ${ctx.profile?.niche || "general"}\nBrand colors: ${ctx.profile?.brand_colors?.join(", ") || "none specified"}`,
        maxTokens: 16384,
      };
    }

    case "blend_curator": {
      const visuals = (getPrevOutput(ctx.previousSteps, "visual_direction") as { visuals?: string })?.visuals || "";
      return {
        system: "You are a B-roll curation specialist. For each scene, decide the optimal blend of AI-generated imagery vs stock footage vs motion graphics. Output as JSON array with fields: scene_id, primary_source (dalle/pexels/runway/motion_graphic), secondary_source, blend_ratio, pexels_search_queries (array), transition_type (cut/dissolve/zoom/slide).",
        user: `Curate the visual blend for this video:\n\nVisual direction:\n${visuals.slice(0, 3000)}\n\nOptimize for engagement and visual variety. Ensure at least 2-3 scenes use stock footage and 2-4 scenes use runway for emotional peaks.`,
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
        system: `You are a YouTube script editor. Refine the script for maximum engagement, clarity, and retention. Integrate the best hook from the alternatives. Ensure smooth transitions, eliminate filler, strengthen the narrative arc, and verify word count stays in target range.

CRITICAL: Preserve all visual tags ([DALLE: ...], [RUNWAY: ...], [STOCK: ...], [MOTION_GRAPHIC: ...]) exactly as they appear. Do NOT change tag types or remove tags. Do NOT replace [MOTION_GRAPHIC] visual supplements with narration or vice versa.

Output the complete refined script with all visual tags intact.`,
        user: `Refine this script:\n\n${script}\n\nAlternative hooks to consider:\n${hooks}\n\nRequirements:\n- Integrate the strongest hook\n- Strengthen all transitions\n- Eliminate filler words\n- Keep ALL visual tags ([DALLE:], [RUNWAY:], [STOCK:], [MOTION_GRAPHIC:]) intact\n- Maintain target word count\n\nOutput the complete refined script.`,
        maxTokens: 8192,
      };
    }

    case "timing_sync": {
      const script = (getPrevOutput(ctx.previousSteps, "script_refinement") as { refined_script?: string })?.refined_script || "";
      const visuals = (getPrevOutput(ctx.previousSteps, "visual_direction") as { visuals?: string })?.visuals || "";
      const blend = (getPrevOutput(ctx.previousSteps, "blend_curator") as { blend_plan?: string })?.blend_plan || "";
      const wpm = ctx.format?.wpm || 145;
      return {
        system: `You are a video timing engineer. Map each scene to precise timestamps based on word count and WPM. The voiceover MP3 is the production clock.

CRITICAL RULES:
1. Output ONLY a JSON array — no markdown fences, no commentary.
2. Each entry must have EXACTLY these fields:
   - scene (integer, starting from 1)
   - tag_type (one of: "DALLE", "RUNWAY", "STOCK", "MOTION_GRAPHIC" — MUST match the tag_type from the visual direction plan for that scene. Do NOT change asset assignments.)
   - duration (number, seconds — derived from word count / WPM)
   - label (string — section name from the script)
   - start_time_seconds (number)
   - end_time_seconds (number)
   - transition_in (string: "fade", "cut", "dissolve")
   - transition_out (string: "fade", "cut", "dissolve")
   - visual_asset_id (string — format: TAG_NNN_short_description, e.g. "DALLE_001_hands_reaching_table", "RUNWAY_003_eye_macro_pullback", "STOCK_012_milgram_experiment", "MOTION_GRAPHIC_005_title_card")
3. Include a final entry for the End Card (tag_type: "MOTION_GRAPHIC", duration: 12, label: "End Card").
4. Duration of each scene is derived from the word count of that section at the given WPM.
5. PRESERVE the tag_type assignments from the visual direction — do not make everything DALLE.`,
        user: `Create timing sync for this production:\n\nNarration WPM: ${wpm}\n\nRefined script:\n${script.slice(0, 3000)}\n\nVisual direction plan (PRESERVE the tag_type assignments):\n${visuals.slice(0, 2000)}\n\nBlend curator plan:\n${blend.slice(0, 1000)}`,
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
