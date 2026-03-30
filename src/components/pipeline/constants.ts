import type { PipelinePhase } from "@/types";

export interface StepDef {
  id: string;
  label: string;
  phase: PipelinePhase;
  order: number;
}

// Must match src/lib/pipeline/steps.ts
export const STEPS: StepDef[] = [
  { id: "topic_research", label: "Topic Research", phase: "pre_production", order: 1 },
  { id: "script_writing", label: "Script Writing", phase: "pre_production", order: 2 },
  { id: "hook_engineering", label: "Hook Engineering", phase: "pre_production", order: 3 },
  { id: "voice_selection", label: "Voice Selection", phase: "pre_production", order: 4 },
  { id: "visual_direction", label: "Visual Direction", phase: "pre_production", order: 5 },
  { id: "blend_curator", label: "Blend Curator", phase: "pre_production", order: 6 },
  { id: "brand_assets", label: "Brand Assets", phase: "pre_production", order: 7 },
  { id: "script_refinement", label: "Script Refinement", phase: "pre_production", order: 8 },
  { id: "timing_sync", label: "Timing Sync", phase: "pre_production", order: 9 },
  { id: "thumbnail_creation", label: "Thumbnail Creation", phase: "pre_production", order: 10 },
  { id: "retention_structure", label: "Retention Structure", phase: "pre_production", order: 11 },
  { id: "comment_magnet", label: "Comment Magnet", phase: "pre_production", order: 12 },
  { id: "upload_blueprint", label: "Upload Blueprint", phase: "pre_production", order: 13 },
  { id: "voiceover_generation", label: "Voiceover Generation", phase: "production", order: 14 },
  { id: "image_generation", label: "Image Generation", phase: "production", order: 15 },
  { id: "motion_graphics", label: "Motion Graphics", phase: "production", order: 16 },
  { id: "motion_graphic_cards", label: "Motion Graphic Cards", phase: "production", order: 17 },
  { id: "stock_footage", label: "Stock Footage", phase: "production", order: 18 },
  { id: "hero_scenes", label: "Hero Scenes", phase: "production", order: 19 },
  { id: "thumbnail_generation", label: "Thumbnail Generation", phase: "production", order: 20 },
];

export const PRE_PROD_STEPS = STEPS.filter(s => s.phase === "pre_production");
export const PROD_STEPS = STEPS.filter(s => s.phase === "production");

// Step output display names (maps output key to readable label)
export const OUTPUT_LABELS: Record<string, string> = {
  research: "Topic Research",
  script: "Script",
  hooks: "Hooks",
  voice_params: "Voice Parameters",
  visuals: "Visual Direction",
  blend_plan: "Blend Plan",
  brand: "Brand Assets",
  refined_script: "Refined Script",
  timing: "Timing Sync",
  thumbnails: "Thumbnail Concepts",
  retention: "Retention Structure",
  engagement: "Comment Magnets",
  upload: "Upload Blueprint",
  motion_specs: "Motion Graphics",
  motion_graphic_cards: "Motion Graphic Cards",
};
