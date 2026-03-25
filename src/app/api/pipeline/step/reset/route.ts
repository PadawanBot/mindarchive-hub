import { NextResponse } from "next/server";
import { getById, update, upsertStep } from "@/lib/store";
import { getStepDef } from "@/lib/pipeline/steps";
import type { Project, PipelineStep } from "@/types";

export async function POST(request: Request) {
  try {
    const { project_id, steps: stepIds } = await request.json();

    const project = await getById<Project>("projects", project_id);
    if (!project) {
      return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
    }

    const reset: string[] = [];
    for (const stepId of stepIds) {
      const stepDef = getStepDef(stepId as PipelineStep);
      if (!stepDef) continue;
      await upsertStep(project_id, stepId, {
        status: "pending",
        output: undefined,
        error: undefined,
        cost_cents: 0,
        duration_ms: 0,
        started_at: undefined,
        completed_at: undefined,
      });
      reset.push(stepId);
    }

    // Set project back to production phase
    await update<Project>("projects", project_id, {
      status: "production",
    } as Partial<Project>);

    return NextResponse.json({ success: true, data: { reset } });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
