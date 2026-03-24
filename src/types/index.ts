// ─── Provider types ───
export type LLMProvider = "anthropic" | "openai";
export type ImageProvider = "dalle" | "pexels";
export type VoiceProvider = "elevenlabs";
export type VideoProvider = "runway" | "pexels";

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
  | "topic_research"
  | "script_writing"
  | "hook_generation"
  | "voice_selection"
  | "visual_direction"
  | "stock_footage"
  | "brand_assets"
  | "script_refinement"
  | "voiceover_generation"
  | "thumbnail_creation"
  | "retention_optimization"
  | "engagement_hooks"
  | "seo_metadata"
  | "scheduling"
  | "video_assembly";

export type StepStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface StepResult {
  step: PipelineStep;
  status: StepStatus;
  output?: Record<string, unknown>;
  error?: string;
  cost_cents?: number;
  duration_ms?: number;
}

// ─── Project ───
export type ProjectStatus = "draft" | "researching" | "scripting" | "producing" | "assembling" | "completed" | "failed";

export interface Project {
  id: string;
  title: string;
  topic: string;
  profile_id: string;
  format_id: string;
  status: ProjectStatus;
  steps: StepResult[];
  total_cost_cents: number;
  output_url?: string;
  script_data?: Record<string, unknown> | null;
  topic_data?: Record<string, unknown> | null;
  visual_data?: Record<string, unknown> | null;
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
