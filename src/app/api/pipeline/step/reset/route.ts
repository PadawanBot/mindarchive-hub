import { NextResponse } from "next/server";
import { getById, update, upsertStep } from "@/lib/store";
import { getStepDef, getDependents } from "@/lib/pipeline/steps";
import type { Project, PipelineStep } from "@/types";

export async function POST(request: Request) {
  try {
    const { project_id, steps: stepIds, cascade } = await request.json();

    const project = await getById<Project>("projects", project_id);
    if (!project) {
      return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
    }

    // Build full list of steps to reset (optionally including dependents)
    let allStepIds = [...stepIds] as PipelineStep[];
    if (cascade) {
      for (const stepId of stepIds) {
        const deps = getDependents(stepId as PipelineStep);
        for (const d of deps) {
          if (!allStepIds.includes(d)) allStepIds.push(d);
        }
      }
    }

    const reset: string[] = [];
    let hasPreProd = false;
    let hasProd = false;

    for (const stepId of allStepIds) {
      const stepDef = getStepDef(stepId as PipelineStep);
      if (!stepDef) continue;
      if (stepDef.phase === "pre_production") hasPreProd = true;
      if (stepDef.phase === "production") hasProd = true;

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

    // Set project status appropriately
    const newStatus = hasPreProd ? "pre_production" : "production";
    await update<Project>("projects", project_id, {
      status: newStatus,
    } as Partial<Project>);

    return NextResponse.json({ success: true, data: { reset } });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
