import { NextResponse } from "next/server";
import { getById, update, upsertStep, getStepsByProject } from "@/lib/store";
import { getStepDef, getNextStep, PIPELINE_STEPS } from "@/lib/pipeline/steps";
import { buildSaveData } from "@/lib/pipeline/prompts";
import { syncStepAssets } from "@/lib/asset-sync";
import type { Project, PipelineStep } from "@/types";

export const maxDuration = 30;

/**
 * Callback from EC2 worker after completing a long-running LLM call.
 * Same save logic as /api/pipeline/step/save but triggered by the worker, not the client.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { step, projectId, status, text, inputTokens, outputTokens, model, error, output, cost_cents } = body;

    if (!step || !projectId) {
      return NextResponse.json({ success: false, error: "Missing step or projectId" }, { status: 400 });
    }

    const stepDef = getStepDef(step as PipelineStep);
    if (!stepDef) {
      return NextResponse.json({ success: false, error: `Unknown step: ${step}` }, { status: 400 });
    }

    const project = await getById<Project>("projects", projectId);
    if (!project) {
      return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
    }

    // Handle failure
    if (status === "failed") {
      await upsertStep(projectId, step, {
        status: "failed",
        output: { error: error || "Worker call failed" },
        completed_at: new Date().toISOString(),
      });
      return NextResponse.json({ success: true, data: { status: "failed" } });
    }

    // Handle direct output from worker (image_generation, etc.)
    // Worker sends {output, cost_cents} directly instead of {text}
    if (output && !text) {
      await upsertStep(projectId, step, {
        status: "completed",
        output,
        cost_cents: cost_cents || 0,
        completed_at: new Date().toISOString(),
      });

      // Auto-sync asset records
      await syncStepAssets(projectId, step, output);

      console.log(`[llm-callback] Step ${step} for project ${projectId} saved (direct output) — cost: ${cost_cents}c`);
      return NextResponse.json({ success: true });
    }

    // Handle LLM text response — same save logic as /api/pipeline/step/save
    if (!text) {
      return NextResponse.json({ success: false, error: "No text or output in callback" }, { status: 400 });
    }

    const saveData = buildSaveData(
      step as PipelineStep,
      text,
      inputTokens || 0,
      outputTokens || 0,
      model || "claude-sonnet-4-6"
    );

    // Save step result
    await upsertStep(projectId, step, {
      status: "completed",
      output: saveData.output,
      cost_cents: saveData.cost_cents,
      completed_at: new Date().toISOString(),
    });

    // Apply project updates (e.g., visual_data for visual_direction)
    if (saveData.projectUpdates) {
      await update<Project>("projects", projectId, saveData.projectUpdates);
    }

    // Auto-sync asset records
    await syncStepAssets(projectId, step, saveData.output);

    // Check if all steps done
    const updatedSteps = await getStepsByProject(projectId);
    const allCompleted = PIPELINE_STEPS.every(s => {
      const sr = updatedSteps.find(us => us.step === s.id);
      return sr?.status === "completed" || sr?.status === "skipped" || s.skippable;
    });
    if (allCompleted) {
      const totalCost = updatedSteps.reduce((sum, s) => sum + (s.cost_cents || 0), 0);
      await update<Project>("projects", projectId, {
        status: "completed",
        total_cost_cents: totalCost,
      } as Partial<Project>);
    }

    console.log(`[llm-callback] Step ${step} for project ${projectId} saved — ${outputTokens} tokens, ${text.length} chars`);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[llm-callback] Error:", error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
