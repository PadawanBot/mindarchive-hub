import { NextResponse } from "next/server";
import { getStepsByProject, upsertStep } from "@/lib/store";

export async function POST(request: Request) {
  try {
    const { project_id, step, output_update } = await request.json();
    // Get current step data
    const steps = await getStepsByProject(project_id);
    const existing = steps.find(s => s.step === step);
    if (!existing) return NextResponse.json({ success: false, error: "Step not found" }, { status: 404 });

    // Merge output_update into existing output
    const mergedOutput = { ...existing.output, ...output_update };
    await upsertStep(project_id, step, { output: mergedOutput });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
