/**
 * GET /api/pipeline/step/narration-preview?project_id=xxx
 * Returns the extracted narration text that will be sent to ElevenLabs,
 * along with word count and estimated duration — for user review before
 * voiceover_generation runs.
 */
import { NextResponse } from "next/server";
import { getStepsByProject } from "@/lib/store";
import { extractNarration } from "@/lib/pipeline/extract-narration";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("project_id");

    if (!projectId) {
      return NextResponse.json({ success: false, error: "Missing project_id" }, { status: 400 });
    }

    const steps = await getStepsByProject(projectId);

    const refinedStep = steps.find(s => s.step === "script_refinement");
    const scriptStep = steps.find(s => s.step === "script_writing");
    const rawScript =
      (refinedStep?.output as { refined_script?: string })?.refined_script ||
      (scriptStep?.output as { script?: string })?.script || "";

    if (!rawScript) {
      return NextResponse.json({ success: false, error: "No script found — run script_writing first" }, { status: 400 });
    }

    const narration = extractNarration(rawScript);
    const wordCount = narration.split(/\s+/).filter(Boolean).length;
    const estimatedMinutes = Math.round((wordCount / 150) * 10) / 10; // ~150 wpm

    return NextResponse.json({
      success: true,
      data: {
        narration,
        raw_script_chars: rawScript.length,
        narration_chars: narration.length,
        word_count: wordCount,
        estimated_minutes: estimatedMinutes,
        source: refinedStep ? "script_refinement" : "script_writing",
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
