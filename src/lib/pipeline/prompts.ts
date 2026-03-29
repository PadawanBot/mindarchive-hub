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
      const researchOutput = getPrevOutput(ctx.previousSteps, "topic_research") as { research?: string; user_notes?: string } | undefined;
      const research = researchOutput?.research || "";
      const userNotes = researchOutput?.user_notes || "";
      const followupContext = (ctx.project.metadata?.followup_context as string) || "";
      const followupOriginalTopic = (ctx.project.metadata?.followup_original_topic as string) || "";
      const wordMin = ctx.format?.word_count_min || 900;
      const wordMax = ctx.format?.word_count_max || 1400;
      const wpm = ctx.format?.wpm || 140;
      const durMin = ctx.format?.duration_min ? Math.round(ctx.format.duration_min / 60) : 6;
      const durMax = ctx.format?.duration_max ? Math.round(ctx.format.duration_max / 60) : 10;
      return {
        system: `You are an expert YouTube scriptwriter for faceless documentary channels. Write production-ready scripts with explicit scene-by-scene structure.

OUTPUT FORMAT — follow this structure exactly:

1. METADATA HEADER (at the top):
- Topic, channel name, runtime target, word target

2. PRODUCTION NOTES (brief):
- Narrative strategy, protagonist(s), psychological framework, the twist/mirror moment

3. VISUAL TAG BUDGET (table):
- Count of each tag type: [DALLE], [RUNWAY], [STOCK], [MOTION_GRAPHIC]
- RUNWAY cap: max 4 scenes per video

4. FULL SCRIPT with SCENE-BY-SCENE structure:
- Group scenes into ACTS with emotional arc labels (e.g., "ACT ONE: THE COLD OPEN (0:00 - 0:07) / EMOTIONAL ARC: CURIOSITY")
- Each scene gets: [SCENE N -- DESCRIPTIVE TITLE]
- Then: NARRATION (V.O.): followed by the narration paragraph(s)
- Then: ONE visual tag on its own line: [DALLE: ...], [RUNWAY: ...], [STOCK: ...], or [MOTION_GRAPHIC: ...]

5. WORD COUNT VERIFICATION (at the bottom):
- Total narration words, estimated runtime, RUNWAY count check, DALLE text check

VISUAL TAG RULES:
- [DALLE: <prompt>] — Default for most scenes. Prompt MUST end with "cinematic, photorealistic, 4K documentary style, no text in frame". Never put text in DALLE prompts.
- [RUNWAY: <prompt>] — 5-10s cinematic motion video. ONLY for peak emotional moments. Max 4 per video.
- [STOCK: <2-3 search keywords>] — Real-world footage from Pexels. NO fictional characters.
- [MOTION_GRAPHIC: layout=<type> | text="<content>" | <colour specs>] — Title cards, data cards, checklists, end cards. Layout types: title_card, list_card, checklist, end_card.

Distribution: ~55-60% DALLE, ~15-20% RUNWAY (max 4), ~5-10% STOCK, ~15-20% MOTION_GRAPHIC.

CRITICAL RULES:
- The voiceover MP3 is the production clock — word count drives runtime
- [MOTION_GRAPHIC] is a VISUAL SUPPLEMENT ONLY — never replaces narration. Every concept, list item, and data point MUST be fully narrated in the voiceover. Cards reinforce; they never replace.
- 3-act structure: curiosity → conflict → payoff
- Cold open must hook in 7 seconds
- Each scene = one discrete visual moment (15-20 scenes typical for ${durMin}-${durMax} min video)
- End with Scene N-1 as comment magnet / outro, Scene N as end card [MOTION_GRAPHIC]

Voice style: ${ctx.profile?.voice_style || "professional"}
Channel: ${ctx.profile?.name || "channel"}`,
        user: `Write a YouTube documentary script about: "${ctx.project.topic}"

Research data:
${research}${userNotes ? `\n\nSCRIPTWRITER DIRECTIONS FROM PRODUCER:\n${userNotes}` : ""}${followupContext ? `\n\nFOLLOW-UP CONTEXT — This is a follow-up to a previous production on: "${followupOriginalTopic}"\nThe audience has already watched the original. Build on the narrative, reference the previous video's themes, and deepen the exploration. Do NOT repeat the same content. Original script excerpt for context:\n${followupContext}` : ""}

FORMAT REQUIREMENTS:
- Target word count: ${wordMin}-${wordMax} words
- Target runtime: ${durMin}-${durMax} minutes at ${wpm} WPM
- 15-20 discrete scenes, each with [SCENE N -- TITLE] marker
- RUNWAY scenes: max 4 (save for emotional peaks)
- Include word count verification at the end

Output the complete production-ready script.`,
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
        system: `You are a cinematographer and visual director for faceless YouTube documentary videos. Produce a comprehensive scene-by-scene visual direction document.

OUTPUT FORMAT — follow this structure exactly:

1. ASSET BUDGET SUMMARY (table at top):
   - Count of each tag type: DALLE, RUNWAY, STOCK, MOTION_GRAPHIC
   - Which scene numbers use each tag
   - RUNWAY cap check (max 4 per video)

2. SCENE-BY-SCENE VISUAL DIRECTION — for EVERY scene in the script, output:

   SCENE N -- SCENE TITLE  [TAG_TYPE]
   Narration: (1-line summary of what's being said)
   Environment: (physical space, setting, objects)
   Time of day: (lighting time context)
   Camera: (angle, movement, focal length, DOF)
   Lighting: (key/fill/back, quality, direction, mood)
   Composition: (framing, rule of thirds, leading lines, negative space)
   Colour grade: (palette, contrast, saturation, temperature)
   Style ref: (film/director reference for the DP to match, e.g. "Roger Deakins interior light", "Fincher dinner scenes")

   Then the production spec for the tag type:
   - DALLE: "DALLE prompt: <prompt ending with cinematic, photorealistic, 4K documentary style, no text in frame>" + "Ken Burns: <direction>. Zoom <amount 1.03-1.08>. <duration>s."
   - RUNWAY: "Runway prompt: <5-10s motion prompt>" + "Motion type: <camera movement description>"
   - STOCK: "Stock keywords: <2-3 search terms>" + "Pexels search: <pipe-separated alternative queries>"
   - MOTION_GRAPHIC: "MG spec: layout=<title_card|list_card|checklist|end_card> | text=\\"<content>\\" | <colour specs with hex values>"

   Transition in: <type + duration> (e.g., "CROSSFADE 0.8s from Scene N-1")
   Transition out: <type + duration> (e.g., "CROSSFADE 1.0s to Scene N+1")

3. COLOUR NARRATIVE ARC (at the end):
   - Describe how the colour palette evolves across the 3 acts
   - How colour temperature, saturation, and contrast support the emotional arc

TAG TYPE RULES:
- DALLE (~55-60%): Default for most scenes. Prompt MUST end with "cinematic, photorealistic, 4K documentary style, no text in frame". NEVER put text in DALLE prompts. Include Ken Burns (zoom 1.03-1.08, duration, direction).
- RUNWAY (~15-20%, max 4): Peak emotional/cinematic moments ONLY. 5-10s motion. Include motion_type.
- STOCK (~5-10%): Real-world footage. NO fictional characters or anime terms. Include Pexels-compatible search keywords.
- MOTION_GRAPHIC (~15-20%): Text/data cards. Include layout_type, text_content, colour_scheme with hex values. Types: title_card, list_card, checklist, end_card.

CRITICAL: Cover EVERY scene in the script. Do not stop early. Match scene numbers 1:1 with the script.

4. VISUAL DIRECTION JSON (output after the doc above):

After the Colour Narrative Arc section, output the line:
=== VISUAL DIRECTION JSON ===
Then output a raw JSON array (no markdown fences) with one object per scene:
{
  "scene_id": <integer — scene number>,
  "label": <string — scene title, e.g. "7-SECOND COLD OPEN">,
  "act": <string — "ONE", "TWO", or "THREE">,
  "tag": <string — "DALLE", "RUNWAY", "STOCK", or "MOTION_GRAPHIC">,
  "narration_summary": <string — 1-sentence summary of narration>,
  "transition_in": <string — e.g. "HARD CUT from black", "CROSSFADE 0.8s from Scene 1">,
  "transition_out": <string — e.g. "CROSSFADE 0.8s to Scene 2", "CUT to Scene 3">,
  <tag-specific fields>:
    DALLE → "dalle_prompt": <full DALL-E prompt string>, "ken_burns": <e.g. "Slow zoom-in. Zoom 1.04. 5s duration.">
    RUNWAY → "runway_prompt": <motion prompt string>, "motion_type": <camera movement description>
    STOCK → "stock_keywords": <2-3 search terms string>, "pexels_keywords": <array of alternative search strings>
    MOTION_GRAPHIC → "motion_graphic_spec": <layout + text + colour spec string>
}`,
        user: `Create visual direction for this script:\n\n${script.slice(0, 25000)}\n\nChannel: ${ctx.profile?.name || "channel"}\nNiche: ${ctx.profile?.niche || "general"}\nBrand colors: ${ctx.profile?.brand_colors?.join(", ") || "none specified"}\n\nIMPORTANT: Cover EVERY scene. Do NOT stop early. Produce the full asset budget summary, all scene directions, the colour narrative arc, AND the JSON array (after the line === VISUAL DIRECTION JSON ===).`,
        maxTokens: 16384,
      };
    }

    case "blend_curator": {
      const visuals = (getPrevOutput(ctx.previousSteps, "visual_direction") as { visuals?: string })?.visuals || "";
      return {
        system: "You are a B-roll curation specialist. For each scene, decide the optimal blend of AI-generated imagery vs stock footage vs motion graphics. Output as JSON array with fields: scene_id, primary_source (dalle/pexels/runway/motion_graphic), secondary_source, blend_ratio, pexels_search_queries (array), transition_type (cut/dissolve/zoom/slide).",
        user: `Curate the visual blend for this video:\n\nVisual direction:\n${visuals.slice(0, 25000)}\n\nOptimize for engagement and visual variety. Ensure at least 2-3 scenes use stock footage and 2-4 scenes use runway for emotional peaks.`,
        maxTokens: 8192,
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
        user: `Create timing sync for this production:\n\nNarration WPM: ${wpm}\n\nRefined script (COMPLETE — process ALL sections):\n${script.slice(0, 25000)}\n\nVisual direction plan (PRESERVE the tag_type assignments — EVERY scene must appear in the timing):\n${visuals.slice(0, 50000)}\n\nBlend curator plan:\n${blend.slice(0, 15000)}\n\nIMPORTANT: You MUST produce a timing entry for EVERY scene in the visual direction plan. Do NOT stop after a few sections. The complete video has 15-25 scenes.`,
        maxTokens: 16384,
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
