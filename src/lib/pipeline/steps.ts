import type { PipelineStep, PipelinePhase } from "@/types";

export interface StepDefinition {
  id: PipelineStep;
  label: string;
  phase: PipelinePhase;
  order: number;
  provider: "llm" | "elevenlabs" | "dalle" | "pexels" | "runway" | "none";
  dependsOn: PipelineStep[];
  description: string;
  skippable: boolean;
}

export const PIPELINE_STEPS: StepDefinition[] = [
  // ─── Pre-production (1-13) ───
  {
    id: "topic_research",
    label: "Topic Research",
    phase: "pre_production",
    order: 1,
    provider: "llm",
    dependsOn: [],
    description: "Deep-dive research on the topic including key talking points, statistics, data, and audience hooks.",
    skippable: false,
  },
  {
    id: "script_writing",
    label: "Script Writing",
    phase: "pre_production",
    order: 2,
    provider: "llm",
    dependsOn: ["topic_research"],
    description: "Full narration script with visual cues, structured per format preset sections and word count range.",
    skippable: false,
  },
  {
    id: "hook_engineering",
    label: "Hook Engineering",
    phase: "pre_production",
    order: 3,
    provider: "llm",
    dependsOn: ["script_writing"],
    description: "Generate 3 alternative viral hooks optimized for first-5-second retention.",
    skippable: false,
  },
  {
    id: "voice_selection",
    label: "Voice Selection",
    phase: "pre_production",
    order: 4,
    provider: "llm",
    dependsOn: ["script_writing"],
    description: "Recommend voice parameters (pace, tone, emphasis markers) based on script mood and channel profile.",
    skippable: true,
  },
  {
    id: "visual_direction",
    label: "Visual Direction",
    phase: "pre_production",
    order: 5,
    provider: "llm",
    dependsOn: ["script_writing"],
    description: "Create DALL-E image prompts (no text) and Pexels search queries for each script section.",
    skippable: false,
  },
  {
    id: "blend_curator",
    label: "Blend Curator",
    phase: "pre_production",
    order: 6,
    provider: "llm",
    dependsOn: ["visual_direction"],
    description: "Curate the mix of AI-generated imagery, stock footage, and motion graphics per section.",
    skippable: true,
  },
  {
    id: "brand_assets",
    label: "Brand Assets",
    phase: "pre_production",
    order: 7,
    provider: "llm",
    dependsOn: ["visual_direction"],
    description: "Define brand-consistent color palettes, lower-thirds, intro/outro templates, and watermark specs.",
    skippable: true,
  },
  {
    id: "script_refinement",
    label: "Script Refinement",
    phase: "pre_production",
    order: 8,
    provider: "llm",
    dependsOn: ["script_writing", "hook_engineering"],
    description: "Polish pacing, strengthen transitions, integrate the best hook, and eliminate filler.",
    skippable: false,
  },
  {
    id: "timing_sync",
    label: "Timing Sync",
    phase: "pre_production",
    order: 9,
    provider: "llm",
    dependsOn: ["script_refinement", "visual_direction"],
    description: "Map each visual asset to narration timestamps based on WPM and word count per section.",
    skippable: false,
  },
  {
    id: "thumbnail_creation",
    label: "Thumbnail Creation",
    phase: "pre_production",
    order: 10,
    provider: "llm",
    dependsOn: ["script_writing", "brand_assets"],
    description: "Design 2-3 thumbnail concepts with DALL-E prompts (no text) and Pillow text overlay specs.",
    skippable: false,
  },
  {
    id: "retention_structure",
    label: "Retention Structure",
    phase: "pre_production",
    order: 11,
    provider: "llm",
    dependsOn: ["script_refinement", "timing_sync"],
    description: "Insert pattern interrupts, curiosity loops, and re-hook points throughout the timeline.",
    skippable: true,
  },
  {
    id: "comment_magnet",
    label: "Comment Magnet",
    phase: "pre_production",
    order: 12,
    provider: "llm",
    dependsOn: ["script_refinement"],
    description: "Generate pinned comment, in-video questions, and engagement prompts to drive comments.",
    skippable: true,
  },
  {
    id: "upload_blueprint",
    label: "Upload Blueprint",
    phase: "pre_production",
    order: 13,
    provider: "llm",
    dependsOn: ["script_refinement", "thumbnail_creation"],
    description: "SEO-optimized title, description, tags, end screens, cards, and scheduling recommendation.",
    skippable: false,
  },

  // ─── Production (14-21) ───
  {
    id: "narration_review",
    label: "Narration Review",
    phase: "production",
    order: 14,
    provider: "none",
    dependsOn: ["script_refinement"],
    description: "Extract and display the narration text that will be sent to ElevenLabs — visual tags, scene markers, and production notes stripped. Review before voiceover generation.",
    skippable: false,
  },
  {
    id: "voiceover_generation",
    label: "Voiceover Generation",
    phase: "production",
    order: 15,
    provider: "elevenlabs",
    dependsOn: ["narration_review", "voice_selection"],
    description: "Generate TTS audio from the narration review output using ElevenLabs. The voiceover MP3 is the production clock.",
    skippable: false,
  },
  {
    id: "image_generation",
    label: "Image Generation",
    phase: "production",
    order: 16,
    provider: "dalle",
    dependsOn: ["visual_direction", "timing_sync"],
    description: "Generate DALL-E images for each section using the visual direction prompts. No text in images.",
    skippable: false,
  },
  {
    id: "motion_graphics",
    label: "Motion Graphics",
    phase: "production",
    order: 17,
    provider: "llm",
    dependsOn: ["timing_sync", "brand_assets"],
    description: "Define motion graphic overlays, lower-thirds, and transitions. MOTION_GRAPHIC tags are visual supplements only.",
    skippable: true,
  },
  {
    id: "motion_graphic_cards",
    label: "Motion Graphic Cards",
    phase: "production",
    order: 18,
    provider: "none",
    dependsOn: ["motion_graphics", "visual_direction"],
    description: "Pre-render MOTION_GRAPHIC scene cards as PNG images via the EC2 worker for review before assembly.",
    skippable: true,
  },
  {
    id: "stock_footage",
    label: "Stock Footage",
    phase: "production",
    order: 19,
    provider: "pexels",
    dependsOn: ["blend_curator"],
    description: "Search and select stock video clips from Pexels based on the blend curator output.",
    skippable: true,
  },
  {
    id: "hero_scenes",
    label: "Hero Scenes",
    phase: "production",
    order: 20,
    provider: "runway",
    dependsOn: ["image_generation"],
    description: "Generate cinematic hero shots using Runway AI from key DALL-E images.",
    skippable: true,
  },
  {
    id: "thumbnail_generation",
    label: "Thumbnail Generation",
    phase: "production",
    order: 21,
    provider: "dalle",
    dependsOn: ["thumbnail_creation"],
    description: "Generate DALL-E thumbnail images from the thumbnail concepts. No text in images — text overlays are added in post-production.",
    skippable: true,
  },
];

/**
 * Get a step definition by its ID.
 */
export function getStepDef(stepId: PipelineStep): StepDefinition | undefined {
  return PIPELINE_STEPS.find((s) => s.id === stepId);
}

/**
 * Get the next step in the pipeline after the given step.
 * Returns undefined if the given step is the last one.
 */
export function getNextStep(stepId: PipelineStep): StepDefinition | undefined {
  const current = PIPELINE_STEPS.find((s) => s.id === stepId);
  if (!current) return undefined;
  return PIPELINE_STEPS.find((s) => s.order === current.order + 1);
}

/**
 * Check whether a step can run given a set of already-completed step IDs.
 * A step can run if all of its dependencies are in the completed set.
 */
export function canRunStep(
  stepId: PipelineStep,
  completedSteps: Set<PipelineStep>
): boolean {
  const def = getStepDef(stepId);
  if (!def) return false;
  return def.dependsOn.every((dep) => completedSteps.has(dep));
}

/** Get all steps from a given order onward (inclusive). */
export function getStepsFromOrder(order: number): StepDefinition[] {
  return PIPELINE_STEPS.filter((s) => s.order >= order).sort((a, b) => a.order - b.order);
}

/** Get all steps that transitively depend on the given step. */
export function getDependents(stepId: PipelineStep): PipelineStep[] {
  const dependents: PipelineStep[] = [];
  const queue = [stepId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const step of PIPELINE_STEPS) {
      if (step.dependsOn.includes(current) && !dependents.includes(step.id)) {
        dependents.push(step.id);
        queue.push(step.id);
      }
    }
  }
  return dependents;
}
