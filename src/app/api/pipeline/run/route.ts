import { NextResponse } from "next/server";
import { PIPELINE_STEPS } from "@/lib/pipeline/steps";

// This route is deprecated. Use /api/pipeline/step for step-by-step execution.
// Kept for backward compatibility — returns the pipeline definition.
export async function POST() {
  return NextResponse.json({
    success: true,
    data: {
      message: "Use /api/pipeline/step to execute steps individually.",
      steps: PIPELINE_STEPS.map(s => ({
        id: s.id,
        label: s.label,
        phase: s.phase,
        order: s.order,
        skippable: s.skippable,
      })),
    },
  });
}
