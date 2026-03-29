import type { Project, ChannelProfile, FormatPreset, PipelineStep, StepResult, AssetSources } from "@/types";
import { DEFAULT_ASSET_SOURCES } from "@/types";
import { generateWithClaude } from "@/lib/providers/anthropic";
import { generateWithGPT } from "@/lib/providers/openai";
import { generateImage } from "@/lib/providers/openai";
import { generateVoiceover } from "@/lib/providers/elevenlabs";
import { downloadAndStore, uploadAsset } from "@/lib/storage";
import { searchVideos } from "@/lib/providers/pexels";
import { generateVideo } from "@/lib/providers/runway";

// ─── Prompt sanitization for video generation ───

const COPYRIGHTED_REPLACEMENTS: [RegExp, string][] = [
  // Anime / manga characters
  [/\bGoku\b/gi, "a warrior in an orange gi"],
  [/\bVegeta\b/gi, "a proud rival warrior in battle armor"],
  [/\bNaruto\b/gi, "a young ninja in an orange jumpsuit"],
  [/\bSasuke\b/gi, "a dark-haired rival ninja"],
  [/\bLuffy\b/gi, "a young pirate captain in a straw hat"],
  [/\bRyuk\b/gi, "a skeletal death spirit"],
  [/\bLight Yagami\b/gi, "a cunning student with a supernatural notebook"],
  [/\bDeath Note\b/gi, "a supernatural notebook"],
  [/\bDragon Ball\b/gi, "martial arts tournament"],
  [/\bOne Piece\b/gi, "pirate adventure"],
  [/\bSaiyan\b/gi, "powerful warrior race"],
  [/\bKamehameha\b/gi, "massive energy beam attack"],
  [/\bRasengan\b/gi, "swirling energy sphere"],
  [/\bSharingan\b/gi, "mystical red eye power"],
  // Western characters
  [/\bSpider[- ]?Man\b/gi, "a masked hero in a red and blue suit"],
  [/\bBatman\b/gi, "a dark caped vigilante"],
  [/\bSuperman\b/gi, "a powerful hero in a red cape"],
  [/\bIron Man\b/gi, "a hero in powered armor"],
  [/\bThanos\b/gi, "a cosmic titan"],
  [/\bDarth Vader\b/gi, "a dark armored villain"],
  [/\bYoda\b/gi, "a small wise green elder"],
  [/\bHarry Potter\b/gi, "a young wizard with round glasses"],
  [/\bHogwarts\b/gi, "a magical castle school"],
  // Game characters
  [/\bMario\b/gi, "a mustachioed plumber in a red cap"],
  [/\bLink\b(?=.*[Zz]elda| hero| sword)/gi, "a green-clad hero"],
  [/\bPikachu\b/gi, "a small yellow electric creature"],
  [/\bPok[eé]mon\b/gi, "collectible creatures"],
  // Franchise names (broad)
  [/\bMarvel\b/gi, "superhero"],
  [/\bDC Comics\b/gi, "superhero"],
  [/\bDisney\b/gi, "animated"],
  [/\bStar Wars\b/gi, "space opera"],
];

/**
 * Strip copyrighted character/franchise names from prompts and
 * prepend a style prefix for consistent video generation.
 */
function sanitizePrompt(prompt: string, stylePrefix = "Cinematic photorealistic 4K documentary style. "): string {
  let cleaned = prompt;
  for (const [pattern, replacement] of COPYRIGHTED_REPLACEMENTS) {
    cleaned = cleaned.replace(pattern, replacement);
  }
  // Collapse any doubled spaces from replacements
  cleaned = cleaned.replace(/  +/g, " ").trim();
  // Prepend style prefix if not already present
  if (!cleaned.toLowerCase().startsWith(stylePrefix.toLowerCase().trim().toLowerCase())) {
    cleaned = stylePrefix + cleaned;
  }
  return cleaned;
}

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

/** Resolve effective asset sources: project override > channel profile > defaults */
function getAssetSources(ctx: StepContext): AssetSources {
  return {
    ...DEFAULT_ASSET_SOURCES,
    ...(ctx.profile?.asset_sources || {}),
    ...(ctx.project.asset_sources || {}),
  };
}

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
  const wordMin = ctx.format?.word_count_min || 900;
  const wordMax = ctx.format?.word_count_max || 1400;
  const wpm = ctx.format?.wpm || 140;
  const durMin = ctx.format?.duration_min ? Math.round(ctx.format.duration_min / 60) : 6;
  const durMax = ctx.format?.duration_max ? Math.round(ctx.format.duration_max / 60) : 10;

  const result = await callLLM(ctx,
    `You are an expert YouTube scriptwriter for faceless documentary channels. Write production-ready scripts with explicit scene-by-scene structure.

OUTPUT FORMAT — follow this structure exactly:

1. METADATA HEADER: Topic, channel name, runtime target, word target
2. PRODUCTION NOTES: Narrative strategy, protagonist(s), framework, the twist
3. VISUAL TAG BUDGET: Count of each tag type used
4. FULL SCRIPT with SCENE-BY-SCENE structure:
   - Group scenes into ACTS with emotional arc labels
   - Each scene: [SCENE N -- DESCRIPTIVE TITLE]
   - Then: NARRATION (V.O.): followed by narration
   - Then: ONE visual tag on its own line
5. WORD COUNT VERIFICATION at the bottom

VISUAL TAG RULES:
- [DALLE: <prompt>] — Default. Prompt MUST end with "cinematic, photorealistic, 4K documentary style, no text in frame".
- [RUNWAY: <prompt>] — 5-10s motion video. Peak emotional moments ONLY. Max 4 per video.
- [STOCK: <keywords>] — Real-world footage. NO fictional characters.
- [MOTION_GRAPHIC: layout=<type> | text="<content>" | <colours>] — Title/data/checklist/end cards.

CRITICAL RULES:
- Voiceover MP3 is the production clock — word count drives runtime
- [MOTION_GRAPHIC] is VISUAL SUPPLEMENT ONLY — never replaces narration
- Never put text in DALLE prompts
- 3-act structure: curiosity → conflict → payoff
- Cold open hooks in 7 seconds
- 15-20 discrete scenes for ${durMin}-${durMax} min video
- End with comment magnet + end card

Voice style: ${ctx.profile?.voice_style || "professional"}
Channel: ${ctx.profile?.name || "channel"}`,
    `Write a YouTube documentary script about: "${ctx.project.topic}"

Research data:
${research}

FORMAT REQUIREMENTS:
- Target word count: ${wordMin}-${wordMax} words
- Target runtime: ${durMin}-${durMax} minutes at ${wpm} WPM
- 15-20 discrete scenes with [SCENE N -- TITLE] markers
- RUNWAY max 4 scenes
- Include word count verification at the end

Output the complete production-ready script.`,
    8192
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
  const script = (getPrevOutput(ctx.previousSteps, "script_refinement") as { refined_script?: string })?.refined_script
    || (getPrevOutput(ctx.previousSteps, "script_writing") as { script?: string })?.script || "";
  const result = await callLLM(ctx,
    `You are a cinematographer and visual director for faceless YouTube documentary videos. Produce a comprehensive scene-by-scene visual direction document.

OUTPUT FORMAT:

1. ASSET BUDGET SUMMARY: Count of each tag type (DALLE, RUNWAY, STOCK, MOTION_GRAPHIC) with scene numbers.

2. SCENE-BY-SCENE VISUAL DIRECTION — for EVERY scene:

   SCENE N -- TITLE  [TAG_TYPE]
   Narration: (1-line summary)
   Environment: (setting, objects)
   Time of day: (lighting context)
   Camera: (angle, movement, DOF)
   Lighting: (key/fill, quality, direction)
   Composition: (framing, rule of thirds, negative space)
   Colour grade: (palette, contrast, saturation)
   Style ref: (film/director reference)
   <production spec for tag type>
   Transition in/out: (type + duration)

   Production specs by tag:
   - DALLE: prompt (ending "cinematic, photorealistic, 4K documentary style, no text in frame") + Ken Burns (zoom 1.03-1.08, duration, direction)
   - RUNWAY: prompt (5-10s) + motion type
   - STOCK: keywords + Pexels search alternatives
   - MOTION_GRAPHIC: layout + text + colour scheme with hex

3. COLOUR NARRATIVE ARC: How palette evolves across acts.

Tag distribution: ~55-60% DALLE, ~15-20% RUNWAY (max 4), ~5-10% STOCK, ~15-20% MOTION_GRAPHIC.
NEVER put text in DALLE prompts. Cover ALL scenes. Do not stop early.

After the Colour Narrative Arc, output the line:
=== VISUAL DIRECTION JSON ===
Then output a raw JSON array (no markdown fences) with one object per scene:
{
  "scene_id": <integer>,
  "label": <scene title string>,
  "act": <"ONE", "TWO", or "THREE">,
  "tag": <"DALLE", "RUNWAY", "STOCK", or "MOTION_GRAPHIC">,
  "narration_summary": <1-sentence narration summary>,
  "transition_in": <e.g. "HARD CUT from black">,
  "transition_out": <e.g. "CROSSFADE 0.8s to Scene 2">,
  <tag-specific>:
    DALLE → "dalle_prompt": <prompt>, "ken_burns": <e.g. "Slow zoom-in. Zoom 1.04. 5s duration.">
    RUNWAY → "runway_prompt": <prompt>, "motion_type": <movement description>
    STOCK → "stock_keywords": <2-3 terms>, "pexels_keywords": [<alternatives>]
    MOTION_GRAPHIC → "motion_graphic_spec": <layout + text + colour spec>
}`,
    `Create visual direction for this script:\n\n${script.slice(0, 25000)}\n\nChannel: ${ctx.profile?.name || "channel"}\nNiche: ${ctx.profile?.niche || "general"}\nBrand colors: ${ctx.profile?.brand_colors?.join(", ") || "none specified"}\n\nIMPORTANT: Cover EVERY scene. Do NOT stop early. End with === VISUAL DIRECTION JSON === followed by the raw JSON array.`,
    16384
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
  const blend = (getPrevOutput(ctx.previousSteps, "blend_curator") as { blend_plan?: string })?.blend_plan || "";
  const wpm = ctx.format?.wpm || 145;
  const result = await callLLM(ctx,
    `You are a video timing engineer. Map each scene to precise timestamps based on word count and WPM. The voiceover MP3 is the production clock.

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
    `Create timing sync for this production:\n\nNarration WPM: ${wpm}\n\nRefined script:\n${script.slice(0, 3000)}\n\nVisual direction plan (PRESERVE the tag_type assignments):\n${visuals.slice(0, 2000)}\n\nBlend curator plan:\n${blend.slice(0, 1000)}`
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
  // Strip visual tags and section headers for voiceover
  const narration = script
    .replace(/\[(DALLE|RUNWAY|STOCK|MOTION_GRAPHIC|VISUAL CUE)[:\s][^\]]*\]/gi, "")
    .replace(/^#{1,3}\s.*$/gm, "")
    .replace(/^---+$/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

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

  // Read the full audio stream with a timeout
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  if (reader) {
    const timeout = setTimeout(() => reader.cancel(), 45_000);
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        totalBytes += value.length;
      }
    } catch {
      // Timeout or stream error — use what we have
    } finally {
      clearTimeout(timeout);
    }
  }

  if (totalBytes === 0) {
    throw new Error("ElevenLabs returned empty audio");
  }

  // Combine chunks and upload to Supabase Storage
  const audioBuffer = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    audioBuffer.set(chunk, offset);
    offset += chunk.length;
  }

  // Use timestamped filename to avoid browser/CDN caching on re-runs
  const audioFilename = `voiceover_${Date.now()}.mp3`;
  const audioUrl = await uploadAsset(
    ctx.project.id, audioFilename, audioBuffer.buffer, "audio/mpeg"
  );

  if (!audioUrl) {
    throw new Error("Failed to upload voiceover to Supabase Storage. Check storage bucket config via POST /api/setup");
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
      audio_url: audioUrl,
      audio_size_bytes: totalBytes,
      note: "Audio uploaded to Supabase Storage.",
    },
    cost_cents: Math.ceil(narration.length * 0.003),
  };
};

const image_generation: StepExecutor = async (ctx) => {
  const sources = getAssetSources(ctx);
  if (!sources.dalle_images) return { output: { status: "skipped", reason: "DALL-E images disabled for this production" }, cost_cents: 0 };
  const key = ctx.settings.openai_key;
  if (!key) return { output: { status: "skipped", reason: "No OpenAI API key configured" }, cost_cents: 0 };

  const visuals = (getPrevOutput(ctx.previousSteps, "visual_direction") as { visuals?: string })?.visuals || "";

  // Extract DALL-E prompts from visual direction JSON
  // Handles: {tag_type: "DALLE", prompt: "..."} or {dalle_prompt: "..."}
  let prompts: string[] = [];
  let cleaned = visuals.trim();
  // Strip markdown code fences
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json|JSON)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }
  try {
    let parsed = JSON.parse(cleaned);
    // Handle wrapped objects
    if (!Array.isArray(parsed) && typeof parsed === "object") {
      for (const key of ["scenes", "data", "entries"]) {
        if (Array.isArray(parsed[key])) { parsed = parsed[key]; break; }
      }
    }
    if (Array.isArray(parsed)) {
      prompts = parsed
        .filter((s: Record<string, unknown>) =>
          // New format: tag_type + prompt
          (s.tag_type === "DALLE" && typeof s.prompt === "string") ||
          // Legacy format: dalle_prompt
          typeof s.dalle_prompt === "string"
        )
        .map((s: Record<string, unknown>) =>
          (s.tag_type === "DALLE" ? s.prompt : s.dalle_prompt) as string
        );
    }
  } catch {
    // Fallback: extract prompts with regex from raw text
    const matches = visuals.match(/(?:dalle_prompt|"prompt")["\s:]+["']([^"']+)/gi);
    if (matches) prompts = matches.map(m => m.replace(/(?:dalle_prompt|"prompt")["\s:]+["']/i, "")).slice(0, 15);
  }

  if (prompts.length === 0) {
    return { output: { status: "skipped", reason: "No DALL-E prompts found in visual direction" }, cost_cents: 0 };
  }

  // Generate up to 15 images in parallel batches
  // DALL-E 3 takes ~15-20s each. Batch size 5 = 2 batches for 10 images ≈ 40s
  const maxImages = Math.min(prompts.length, 15);
  const batchSize = 5;
  const images: { prompt: string; url: string; revised_prompt: string; stored: boolean }[] = [];

  // Phase 1: Generate all DALL-E images (parallel batches, ~20s per batch)
  const tempImages: { prompt: string; url: string; revised_prompt: string; index: number }[] = [];
  for (let batch = 0; batch < maxImages; batch += batchSize) {
    const batchPrompts = prompts.slice(batch, batch + batchSize);
    const batchResults = await Promise.all(
      batchPrompts.map(async (p, batchIdx) => {
        const i = batch + batchIdx;
        try {
          const img = await generateImage(key, sanitizePrompt(p));
          return { prompt: p, url: img.url, revised_prompt: img.revisedPrompt, index: i };
        } catch (err) {
          console.error(`[image_generation] Image ${i + 1} failed:`, err);
          return null;
        }
      })
    );
    tempImages.push(...batchResults.filter(Boolean) as typeof tempImages);
  }

  // Phase 2: Persist to storage (all in parallel — don't wait sequentially)
  const storeResults = await Promise.all(
    tempImages.map(async (img) => {
      try {
        const storedUrl = await downloadAndStore(
          ctx.project.id, `dalle-scene-${img.index + 1}.png`, img.url, "image/png"
        );
        return { prompt: img.prompt, url: storedUrl || img.url, revised_prompt: img.revised_prompt, stored: !!storedUrl };
      } catch (err) {
        console.error(`[image_generation] Storage failed for image ${img.index + 1}, using temp URL:`, err);
        return { prompt: img.prompt, url: img.url, revised_prompt: img.revised_prompt, stored: false };
      }
    })
  );
  images.push(...storeResults);

  return {
    output: { status: "completed", images, total_prompts: prompts.length, generated: images.length },
    cost_cents: images.length * 8, // ~$0.08 per DALL-E 3 HD image
  };
};

const stock_footage: StepExecutor = async (ctx) => {
  const sources = getAssetSources(ctx);
  if (!sources.stock_footage) return { output: { status: "skipped", reason: "Stock footage disabled for this production" }, cost_cents: 0 };
  const key = ctx.settings.pexels_key;
  if (!key) return { output: { status: "skipped", reason: "No Pexels API key configured" }, cost_cents: 0 };

  // Use LLM to generate Pexels-optimized search queries based on the visual direction
  // Pexels is a real-world stock footage platform — queries must describe visual atmosphere,
  // mood, lighting, and abstract visuals rather than specific characters or plot points.
  const visuals = (getPrevOutput(ctx.previousSteps, "visual_direction") as { visuals?: string })?.visuals || "";
  const script = (getPrevOutput(ctx.previousSteps, "script_refinement") as { refined_script?: string })?.refined_script || "";

  let queries: string[] = [];
  let llmCost = 0;

  try {
    const queryResult = await callLLM(ctx,
      `You are a stock footage search specialist for Pexels.com. Your job is to translate creative briefs into effective Pexels search queries.

CRITICAL RULES:
- Pexels only has REAL-WORLD footage (nature, cities, people, abstract, particles, etc.)
- NEVER use character names, anime terms, cartoon references, or fictional concepts
- Focus on VISUAL ATMOSPHERE: lighting, mood, color palette, motion, texture
- Each query should be 2-4 words for best Pexels results
- Think about B-roll that would visually complement the narration

Example translations:
- "Epic battle scene with energy blasts" → "dramatic lightning storm dark sky"
- "Character discovers mysterious notebook" → "old leather book dramatic lighting"
- "Dark supernatural power awakening" → "dark fog particles glowing"
- "Intense confrontation between rivals" → "dramatic shadows silhouette contrast"
- "Transformation scene with aura" → "glowing particles energy abstract"`,
      `Generate exactly 5 Pexels search queries for B-roll footage that visually complements this video production.

Topic: ${ctx.project.topic}
Visual direction excerpt: ${visuals.slice(0, 1500)}
Script excerpt: ${script.slice(0, 1000)}

Output as a JSON array of 5 strings. Example: ["dark atmospheric fog", "glowing particles abstract", "dramatic sky clouds timelapse", "old book candlelight", "energy lightning dark"]`,
      500
    );
    llmCost = estimateCost(ctx, queryResult.inputTokens, queryResult.outputTokens);

    // Parse the JSON array from the LLM response
    const text = queryResult.text.trim();
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed)) {
        queries = parsed.filter((q: unknown) => typeof q === "string").slice(0, 5);
      }
    }
  } catch {
    // Fallback to generic atmospheric queries
    queries = ["dramatic dark atmosphere", "abstract particles glowing", "dark sky storm clouds", "mysterious fog light rays", "energy lightning abstract"];
  }

  if (queries.length === 0) {
    queries = ["dramatic dark atmosphere", "abstract particles glowing", "dark sky storm clouds"];
  }

  const results: { query: string; video_count: number; videos: { id: number; url: string; file_url: string; thumbnail: string; duration: number }[] }[] = [];
  for (const q of queries.slice(0, 5)) {
    const videos = await searchVideos(key, q, 3);
    results.push({
      query: q,
      video_count: videos.length,
      videos: videos.map(v => {
        // Get the best quality direct video file URL
        const bestFile = v.video_files
          ?.sort((a, b) => (b.width || 0) - (a.width || 0))
          .find(f => f.quality === "hd") || v.video_files?.[0];
        // Get the first thumbnail picture
        const thumbnail = v.video_pictures?.[0]?.picture || "";
        return {
          id: v.id,
          url: v.url, // Pexels page URL (for attribution)
          file_url: bestFile?.link || v.url, // Direct playable video file
          thumbnail, // Static preview image
          duration: v.duration,
        };
      }),
    });
  }

  return { output: { status: "completed", footage: results }, cost_cents: llmCost };
};

const motion_graphics: StepExecutor = async (ctx) => {
  const timing = (getPrevOutput(ctx.previousSteps, "timing_sync") as { timing?: string })?.timing || "";
  const brand = (getPrevOutput(ctx.previousSteps, "brand_assets") as { brand?: string })?.brand || "";
  const script = (getPrevOutput(ctx.previousSteps, "script_refinement") as { refined_script?: string })?.refined_script || "";

  const result = await callLLM(ctx,
    "You are a motion graphics designer for faceless YouTube videos. Generate structured JSON motion graphic specs that an ffmpeg/Pillow rendering pipeline can consume. Output as JSON with fields: lower_thirds (array of {text, x, y, font_size, color, bg_color, start_time_seconds, end_time_seconds, animation}), title_cards (array of {text, style, duration_seconds, position}), transitions (array of {type, timestamp_seconds, duration_ms}), overlays (array of {type, text, position, start_time, end_time, style}).",
    `Generate motion graphic specs for this video production.\n\nTiming data:\n${timing.slice(0, 2000)}\n\nBrand assets:\n${brand.slice(0, 1500)}\n\nRefined script excerpt:\n${script.slice(0, 2000)}`
  );

  return {
    output: {
      status: "ready_for_render",
      motion_specs: result.text,
      timing_data: timing.slice(0, 500),
      brand_data: brand.slice(0, 500),
    },
    cost_cents: estimateCost(ctx, result.inputTokens, result.outputTokens),
  };
};

const hero_scenes: StepExecutor = async (ctx) => {
  const sources = getAssetSources(ctx);
  if (!sources.hero_scenes) return { output: { status: "skipped", reason: "Hero scenes disabled for this production" }, cost_cents: 0 };
  const key = ctx.settings.runway_key;
  if (!key) return { output: { status: "skipped", reason: "No Runway ML API key configured" }, cost_cents: 0 };

  // Get RUNWAY prompts from visual direction
  const visualOutput = getPrevOutput(ctx.previousSteps, "visual_direction") as { visuals?: string } | undefined;
  let scenePrompts: { section: string; dalle_prompt: string }[] = [];
  if (visualOutput?.visuals) {
    let cleaned = visualOutput.visuals.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json|JSON)?\s*\n?/, "").replace(/\n?```\s*$/, "");
    }
    try {
      let parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed) && typeof parsed === "object") {
        for (const k of ["scenes", "data", "entries"]) {
          if (Array.isArray(parsed[k])) { parsed = parsed[k]; break; }
        }
      }
      const scenes = Array.isArray(parsed) ? parsed : [];
      // Extract RUNWAY-tagged scenes (new format) or fallback to dalle_prompt
      scenePrompts = scenes
        .filter((s: Record<string, unknown>) =>
          (s.tag_type === "RUNWAY" && typeof s.prompt === "string") ||
          typeof s.dalle_prompt === "string"
        )
        .map((s: Record<string, unknown>) => ({
          section: String(s.scene || s.section || "Hero Scene"),
          dalle_prompt: String(s.tag_type === "RUNWAY" ? s.prompt : s.dalle_prompt),
        }));
    } catch {}
  }

  // Also try getting prompts from the script for richer descriptions
  if (scenePrompts.length === 0) {
    const script = (getPrevOutput(ctx.previousSteps, "script_refinement") as { refined_script?: string })?.refined_script
      || (getPrevOutput(ctx.previousSteps, "script_writing") as { script?: string })?.script || "";

    // Build cinematic prompts from the script's visual cues
    const visualCues = script.match(/\[VISUAL CUE:([^\]]+)\]/g) || [];
    if (visualCues.length > 0) {
      scenePrompts = visualCues.slice(0, 3).map((cue, i) => ({
        section: `Scene ${i + 1}`,
        dalle_prompt: cue.replace(/\[VISUAL CUE:\s*/, "").replace(/\]$/, "").trim(),
      }));
    } else {
      // Generic cinematic fallback — no copyrighted references
      scenePrompts = [
        {
          section: "Cold Open",
          dalle_prompt: `Cinematic dramatic opening scene. A lone figure stands at the edge of a vast landscape, golden sunset rays cutting through storm clouds. Epic atmosphere, hyper-detailed, movie quality. Topic: ${ctx.project.topic}`,
        },
        {
          section: "Climax",
          dalle_prompt: `Dramatic confrontation scene. Two powerful figures face each other — one radiating golden energy, the other shrouded in dark shadows. Lightning crackles, intense emotional close-up, movie quality. Topic: ${ctx.project.topic}`,
        },
      ];
    }
  }

  // Generate up to 5 hero scenes via text-to-video (pipeline rule: max 3-5 RUNWAY per video)
  const toProcess = scenePrompts.slice(0, 5);
  const scenes: { promptText: string; section: string; taskId: string }[] = [];

  for (const scene of toProcess) {
    try {
      const promptText = sanitizePrompt(scene.dalle_prompt).slice(0, 1000);
      const result = await generateVideo(key, promptText);
      scenes.push({
        section: scene.section || "Hero Scene",
        promptText,
        taskId: result.taskId,
      });
    } catch (err) {
      scenes.push({
        section: scene.section || "Hero Scene",
        promptText: scene.dalle_prompt.slice(0, 512),
        taskId: `error: ${String(err)}`,
      });
    }
  }

  const successCount = scenes.filter((s) => !s.taskId.startsWith("error:")).length;

  return {
    output: {
      status: successCount > 0 ? "completed" : "failed",
      scenes,
      total_requested: toProcess.length,
      tasks_started: successCount,
      note: "Video generation tasks started via text-to-video. Auto-polling will check for completion.",
    },
    cost_cents: successCount * 50,
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
