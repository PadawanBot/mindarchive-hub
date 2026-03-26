import { NextResponse } from "next/server";
import { getById, update, getAllSettings, upsertStep, getStepsByProject } from "@/lib/store";
import { executors } from "@/lib/pipeline/executors";
import { getStepDef, canRunStep, getNextStep, PIPELINE_STEPS } from "@/lib/pipeline/steps";
import { deleteAssetsByStep } from "@/lib/asset-db";
import { syncStepAssets } from "@/lib/asset-sync";
import type { Project, ChannelProfile, FormatPreset, PipelineStep, StepResult } from "@/types";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const { project_id, step, force } = await request.json();

    // Validate step
    const stepDef = getStepDef(step as PipelineStep);
    if (!stepDef) {
      return NextResponse.json({ success: false, error: `Unknown step: ${step}` }, { status: 400 });
    }

    // Load project
    const project = await getById<Project>("projects", project_id);
    if (!project) {
      return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
    }

    // Load existing steps
    const existingSteps = await getStepsByProject(project_id);

    // Check if already completed (idempotent — skip unless force re-run)
    if (!force) {
      const existing = existingSteps.find(s => s.step === step && s.status === "completed");
      if (existing) {
        const next = getNextStep(step as PipelineStep);
        return NextResponse.json({
          success: true,
          data: { step_result: existing, next_step: next?.id || null, already_completed: true },
        });
      }
    }

    // Check dependencies
    const completedSet = new Set(
      existingSteps.filter(s => s.status === "completed" || s.status === "skipped").map(s => s.step)
    );
    if (!canRunStep(step as PipelineStep, completedSet)) {
      const missing = stepDef.dependsOn.filter(d => !completedSet.has(d));
      return NextResponse.json({
        success: false,
        error: `Step "${stepDef.label}" requires: ${missing.join(", ")}`,
      }, { status: 400 });
    }

    // Mark step as running
    const now = new Date().toISOString();
    await upsertStep(project_id, step, { status: "running", started_at: now });

    // Clean up stale asset records from previous runs
    if (force) {
      await deleteAssetsByStep(project_id, step);
    }

    // Update project status
    const newStatus = stepDef.phase === "pre_production" ? "pre_production" : "production";
    if (project.status === "draft" || project.status === "failed") {
      await update<Project>("projects", project_id, { status: newStatus } as Partial<Project>);
    }

    // Load context
    const profile = project.profile_id
      ? await getById<ChannelProfile>("profiles", project.profile_id)
      : undefined;
    const format = project.format_id
      ? await getById<FormatPreset>("format_presets", project.format_id)
      : undefined;
    const settings = await getAllSettings();

    const ctx = { project, profile, format, previousSteps: existingSteps, settings };

    // Execute
    const startTime = Date.now();
    const executor = executors[step as PipelineStep];

    try {
      const result = await executor(ctx);
      const durationMs = Date.now() - startTime;

      // Determine if this was skipped
      const isSkipped = result.output?.status === "skipped";
      const finalStatus = isSkipped ? "skipped" as const : "completed" as const;

      // Save step result
      const stepResult = await upsertStep(project_id, step, {
        status: finalStatus,
        output: result.output,
        cost_cents: result.cost_cents,
        duration_ms: durationMs,
        completed_at: new Date().toISOString(),
      });

      // Apply project updates if any
      if (result.projectUpdates) {
        await update<Project>("projects", project_id, result.projectUpdates);
      }

      // Auto-sync asset records (best-effort)
      if (!isSkipped) {
        await syncStepAssets(project_id, step, result.output);
      }

      // Check if this was the last step
      const updatedSteps = await getStepsByProject(project_id);
      const allCompleted = PIPELINE_STEPS.every(s => {
        const stepResult2 = updatedSteps.find(us => us.step === s.id);
        return stepResult2?.status === "completed" || stepResult2?.status === "skipped" || s.skippable;
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
      const durationMs = Date.now() - startTime;
      await upsertStep(project_id, step, {
        status: "failed",
        error: String(error),
        duration_ms: durationMs,
        completed_at: new Date().toISOString(),
      });
      await update<Project>("projects", project_id, { status: "failed" } as Partial<Project>);

      return NextResponse.json({
        success: false,
        error: `Step "${stepDef.label}" failed: ${String(error)}`,
      }, { status: 500 });
    }
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
