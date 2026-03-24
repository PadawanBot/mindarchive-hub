import { NextResponse } from "next/server";
import type { FormatPreset } from "@/types";

// Built-in format presets (no DB needed)
const BUILT_IN_FORMATS: FormatPreset[] = [
  {
    id: "documentary",
    name: "Documentary",
    type: "documentary",
    duration_min: 480,
    duration_max: 600,
    word_count_min: 1120,
    word_count_max: 1400,
    wpm: 140,
    sections: ["hook", "intro", "section_1", "section_2", "section_3", "conclusion", "cta"],
    description: "Deep-dive documentary style. 8-10 minutes, rich narration with cinematic visuals.",
  },
  {
    id: "explainer",
    name: "Explainer",
    type: "explainer",
    duration_min: 300,
    duration_max: 420,
    word_count_min: 750,
    word_count_max: 1050,
    wpm: 150,
    sections: ["hook", "problem", "solution", "examples", "conclusion", "cta"],
    description: "Clear explainer format. 5-7 minutes, focused on making complex topics simple.",
  },
  {
    id: "listicle",
    name: "Listicle",
    type: "listicle",
    duration_min: 600,
    duration_max: 900,
    word_count_min: 1450,
    word_count_max: 2175,
    wpm: 145,
    sections: ["hook", "intro", "item_1", "item_2", "item_3", "item_4", "item_5", "conclusion", "cta"],
    description: "Numbered list format. 10-15 minutes, high retention through countdown structure.",
  },
  {
    id: "tutorial",
    name: "Tutorial",
    type: "tutorial",
    duration_min: 420,
    duration_max: 600,
    word_count_min: 1050,
    word_count_max: 1500,
    wpm: 150,
    sections: ["hook", "overview", "step_1", "step_2", "step_3", "step_4", "recap", "cta"],
    description: "Step-by-step tutorial. 7-10 minutes, practical and actionable.",
  },
  {
    id: "storytime",
    name: "Storytime",
    type: "storytime",
    duration_min: 360,
    duration_max: 540,
    word_count_min: 900,
    word_count_max: 1350,
    wpm: 150,
    sections: ["cold_open", "setup", "rising_action", "climax", "resolution", "lesson", "cta"],
    description: "Narrative storytelling. 6-9 minutes, emotional arc with a takeaway.",
  },
  {
    id: "debate",
    name: "Debate",
    type: "debate",
    duration_min: 480,
    duration_max: 720,
    word_count_min: 1120,
    word_count_max: 1680,
    wpm: 140,
    sections: ["hook", "context", "side_a", "side_b", "analysis", "verdict", "cta"],
    description: "Two-sided analysis. 8-12 minutes, balanced exploration of controversial topics.",
  },
];

export async function GET() {
  return NextResponse.json({ success: true, data: BUILT_IN_FORMATS });
}
