import { NextResponse } from "next/server";
import { getById, update, getAllSettings, upsertStep, getStepsByProject } from "@/lib/store";
import { executors } from "@/lib/pipeline/executors";
import { getStepDef, canRunStep, getNextStep, PIPELINE_STEPS } from "@/lib/pipeline/steps";
import type { Project, ChannelProfile, FormatPreset, PipelineStep, StepResult } from "@/types";

// Streaming responses on Vercel Hobby can run up to 300s (vs 60s for non-streaming)
export const maxDuration = 300;

function sseMessage(data: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

export async function POST(request: Request) {
  // ── Validation (fast, non-streaming) ──
  let body: { project_id: string; step: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const { project_id, step } = body;

  const stepDef = getStepDef(step as PipelineStep);
  if (!stepDef) {
    return NextResponse.json({ success: false, error: `Unknown step: ${step}` }, { status: 400 });
  }

  const project = await getById<Project>("projects", project_id);
  if (!project) {
    return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
  }

  const existingSteps = await getStepsByProject(project_id);

  // Idempotent — already completed
  const existing = existingSteps.find(s => s.step === step && s.status === "completed");
  if (existing) {
    const next = getNextStep(step as PipelineStep);
    return NextResponse.json({
      success: true,
      data: { step_result: existing, next_step: next?.id || null, already_completed: true },
    });
  }

  // Dependency check
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

  // ── Streaming execution (long-running) ──
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  // Fire-and-forget the execution into the stream
  (async () => {
    // Send heartbeats every 10s to keep the connection alive
    const heartbeat = setInterval(() => {
      writer.write(sseMessage({ heartbeat: true, step })).catch(() => {});
    }, 10_000);

    try {
      // Mark step as running
      const now = new Date().toISOString();
      await upsertStep(project_id, step, { status: "running", started_at: now });

      writer.write(sseMessage({ status: "running", step }));

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

      // Execute the step
      const startTime = Date.now();
      const executor = executors[step as PipelineStep];
      const result = await executor(ctx);
      const durationMs = Date.now() - startTime;

      // Determine status
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

      // Apply project updates
      if (result.projectUpdates) {
        await update<Project>("projects", project_id, result.projectUpdates);
      }

      // Check if all steps are done
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
      await writer.write(sseMessage({
        success: true,
        data: { step_result: stepResult, next_step: next?.id || null },
      }));
    } catch (error) {
      // Save failure to DB
      try {
        await upsertStep(project_id, step, {
          status: "failed",
          error: String(error),
          completed_at: new Date().toISOString(),
        });
        await update<Project>("projects", project_id, { status: "failed" } as Partial<Project>);
      } catch {}

      await writer.write(sseMessage({
        success: false,
        error: `Step "${stepDef.label}" failed: ${String(error)}`,
      }));
    } finally {
      clearInterval(heartbeat);
      await writer.close();
    }
  })();

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
