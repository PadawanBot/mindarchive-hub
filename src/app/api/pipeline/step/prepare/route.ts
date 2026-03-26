import { NextResponse } from "next/server";
import { getById, update, getAllSettings, upsertStep, getStepsByProject } from "@/lib/store";
import { buildPrompt } from "@/lib/pipeline/prompts";
import { getStepDef, canRunStep, getNextStep } from "@/lib/pipeline/steps";
import { deleteAssetsByStep } from "@/lib/asset-db";
import type { Project, ChannelProfile, FormatPreset, PipelineStep } from "@/types";

export const maxDuration = 15;

export async function POST(request: Request) {
  try {
    const { project_id, step, force } = await request.json();

    const stepDef = getStepDef(step as PipelineStep);
    if (!stepDef) {
      return NextResponse.json({ success: false, error: `Unknown step: ${step}` }, { status: 400 });
    }

    const project = await getById<Project>("projects", project_id);
    if (!project) {
      return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
    }

    const existingSteps = await getStepsByProject(project_id);

    // Idempotent — already completed (skip unless force re-run)
    if (!force) {
      const existing = existingSteps.find(s => s.step === step && s.status === "completed");
      if (existing) {
        const next = getNextStep(step as PipelineStep);
        return NextResponse.json({
          success: true,
          data: { already_completed: true, step_result: existing, next_step: next?.id || null },
        });
      }
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

    // Mark running
    const now = new Date().toISOString();
    await upsertStep(project_id, step, { status: "running", started_at: now });

    // Clean up stale asset records from previous runs
    if (force) {
      await deleteAssetsByStep(project_id, step);
    }

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

    // Build prompt for this step
    const prompt = buildPrompt(step as PipelineStep, { project, profile, format, previousSteps: existingSteps, settings });

    if (!prompt) {
      // Non-LLM step (voiceover, image gen, etc.) — run directly
      return NextResponse.json({
        success: true,
        data: { needs_llm: false, step, project_id },
      });
    }

    // Resolve provider + API key
    const provider = profile?.llm_provider || settings.default_provider || settings.default_llm_provider || "anthropic";
    const model = profile?.llm_model || settings.default_model || settings.default_llm_model || "claude-sonnet-4-6";

    return NextResponse.json({
      success: true,
      data: {
        needs_llm: true,
        step,
        project_id,
        provider,
        model,
        system: prompt.system,
        prompt: prompt.user,
        maxTokens: prompt.maxTokens,
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
