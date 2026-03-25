import { NextResponse } from "next/server";
import { getById, update, upsertStep, getStepsByProject, getAllSettings } from "@/lib/store";
import { getStepDef, getNextStep, PIPELINE_STEPS } from "@/lib/pipeline/steps";
import { buildSaveData } from "@/lib/pipeline/prompts";
import { executors } from "@/lib/pipeline/executors";
import type { Project, PipelineStep } from "@/types";

export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const { project_id, step, text, inputTokens, outputTokens, truncated } = await request.json();

    const stepDef = getStepDef(step as PipelineStep);
    if (!stepDef) {
      return NextResponse.json({ success: false, error: `Unknown step: ${step}` }, { status: 400 });
    }

    const project = await getById<Project>("projects", project_id);
    if (!project) {
      return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
    }

    const settings = await getAllSettings();
    const model = settings.default_model || settings.default_llm_model || "claude-sonnet-4-6";

    // Build the save data (output, cost, project updates) from the LLM result
    const saveData = buildSaveData(step as PipelineStep, text, inputTokens, outputTokens, model);

    // Save step result
    const stepResult = await upsertStep(project_id, step, {
      status: "completed",
      output: saveData.output,
      cost_cents: saveData.cost_cents,
      completed_at: new Date().toISOString(),
    });

    // Apply project updates
    if (saveData.projectUpdates) {
      await update<Project>("projects", project_id, saveData.projectUpdates);
    }

    // Check if all done
    const updatedSteps = await getStepsByProject(project_id);
    const allCompleted = PIPELINE_STEPS.every(s => {
      const sr = updatedSteps.find(us => us.step === s.id);
      return sr?.status === "completed" || sr?.status === "skipped" || s.skippable;
    });
    if (allCompleted) {
      const totalCost = updatedSteps.reduce((sum, s) => sum + (s.cost_cents || 0), 0);
      await update<Project>("projects", project_id, {
        status: "completed",
        total_cost_cents: totalCost,
      } as Partial<Project>);
    }

    const next = getNextStep(step as PipelineStep);
    return NextResponse.json({
      success: true,
      data: { step_result: stepResult, next_step: next?.id || null },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
