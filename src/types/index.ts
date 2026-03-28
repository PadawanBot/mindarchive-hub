// ─── Provider types ───
export type LLMProvider = "anthropic" | "openai";
export type ImageProvider = "dalle" | "pexels";
export type VoiceProvider = "elevenlabs";
export type VideoProvider = "runway" | "pexels";

// ─── Asset Sources ───
export interface AssetSources {
  dalle_images: boolean;
  stock_footage: boolean;
  hero_scenes: boolean;
}

export const DEFAULT_ASSET_SOURCES: AssetSources = {
  dalle_images: true,
  stock_footage: true,
  hero_scenes: true,
};

// ─── Channel Profile ───
export interface ChannelProfile {
  id: string;
  name: string;
  niche: string;
  description: string;
  voice_style: string;
  brand_colors: string[];
  target_audience: string;
  llm_provider: LLMProvider;
  llm_model: string;
  image_provider: ImageProvider;
  voice_provider: VoiceProvider;
  voice_id: string;
  asset_sources?: AssetSources;
  created_at: string;
  updated_at: string;
}

// ─── Format Preset ───
export type FormatType = "documentary" | "explainer" | "listicle" | "tutorial" | "storytime" | "debate";

export interface FormatPreset {
  id: string;
  name: string;
  type: FormatType;
  duration_min: number;
  duration_max: number;
  word_count_min: number;
  word_count_max: number;
  wpm: number;
  sections: string[];
  description: string;
}

// ─── Pipeline ───
export type PipelineStep =
  // Pre-production (steps 1-13)
  | "topic_research"
  | "script_writing"
  | "hook_engineering"
  | "voice_selection"
  | "visual_direction"
  | "blend_curator"
  | "brand_assets"
  | "script_refinement"
  | "timing_sync"
  | "thumbnail_creation"
  | "retention_structure"
  | "comment_magnet"
  | "upload_blueprint"
  // Production (steps 14-18)
  | "voiceover_generation"
  | "image_generation"
  | "stock_footage"
  | "motion_graphics"
  | "hero_scenes";

export type PipelinePhase = "pre_production" | "production";

export type StepStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface StepResult {
  step: PipelineStep;
  status: StepStatus;
  output?: Record<string, unknown>;
  error?: string;
  cost_cents?: number;
  duration_ms?: number;
  project_id?: string;
  started_at?: string;
  completed_at?: string;
  created_at?: string;
  modified_at?: string;
}

// ─── Project ───
export type ProjectStatus = "draft" | "pre_production" | "production" | "completed" | "failed" | "paused";

export interface Project {
  id: string;
  title: string;
  topic: string;
  profile_id: string;
  format_id: string;
  status: ProjectStatus;
  steps?: StepResult[];
  total_cost_cents: number;
  output_url?: string;
  output_portrait_url?: string;
  script_data?: Record<string, unknown> | null;
  topic_data?: Record<string, unknown> | null;
  visual_data?: Record<string, unknown> | null;
  asset_sources?: AssetSources; // Override channel profile defaults per-project
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ─── Settings ───
export interface AppSettings {
  anthropic_key?: string;
  openai_key?: string;
  elevenlabs_key?: string;
  pexels_key?: string;
  runway_key?: string;
  default_llm_provider: LLMProvider;
  default_llm_model: string;
  default_image_provider: ImageProvider;
  default_voice_provider: VoiceProvider;
}

// ─── API Response ───
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// ─── Topic Research ───
export interface TopicSuggestion {
  title: string;
  angle: string;
  keywords: string[];
  estimated_interest: "high" | "medium" | "low";
  reasoning: string;
}

// ─── Topic Bank ───
export type TopicStatus = "available" | "in_production" | "produced" | "archived";

export interface TopicBankItem {
  id: string;
  profile_id: string;
  title: string;
  angle: string;
  keywords: string[];
  estimated_interest: "high" | "medium" | "low";
  reasoning: string;
  status: TopicStatus;
  project_id?: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Script ───
export interface ScriptSection {
  id: string;
  type: "hook" | "intro" | "body" | "conclusion" | "cta";
  narration: string;
  visual_cue: string;
  duration_seconds: number;
  word_count: number;
}

export interface Script {
  title: string;
  sections: ScriptSection[];
  total_words: number;
  estimated_duration: number;
}
