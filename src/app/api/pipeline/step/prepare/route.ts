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

    const workerUrl = process.env.WORKER_URL;

    // Build prompt for this step
    const prompt = buildPrompt(step as PipelineStep, { project, profile, format, previousSteps: existingSteps, settings });

    if (!prompt) {
      // Route image_generation to EC2 worker (DALL-E calls exceed Vercel 60s timeout)
      if (step === "image_generation" && workerUrl) {
        const callbackUrl = "https://mindarchive-hub.vercel.app/api/pipeline/step/llm-callback";

        // Extract DALL-E prompts from visual direction (same logic as executor)
        const visualStep = existingSteps.find(s => s.step === "visual_direction");
        const visuals = (visualStep?.output as { visuals?: string })?.visuals || "";
        let dallePrompts: string[] = [];
        let cleaned = visuals.trim();
        if (cleaned.startsWith("```")) {
          cleaned = cleaned.replace(/^```(?:json|JSON)?\s*\n?/, "").replace(/\n?```\s*$/, "");
        }
        try {
          let parsed = JSON.parse(cleaned);
          if (!Array.isArray(parsed) && typeof parsed === "object") {
            for (const k of ["scenes", "data", "entries"]) {
              if (Array.isArray(parsed[k])) { parsed = parsed[k]; break; }
            }
          }
          if (Array.isArray(parsed)) {
            dallePrompts = parsed
              .filter((s: Record<string, unknown>) =>
                (s.tag_type === "DALLE" && typeof s.prompt === "string") ||
                typeof s.dalle_prompt === "string"
              )
              .map((s: Record<string, unknown>) =>
                (s.tag_type === "DALLE" ? s.prompt : s.dalle_prompt) as string
              )
              .slice(0, 15);
          }
        } catch {}

        if (dallePrompts.length > 0) {
          try {
            const workerRes = await fetch(`${workerUrl}/generate-images`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(process.env.WORKER_SECRET ? { Authorization: `Bearer ${process.env.WORKER_SECRET}` } : {}),
              },
              body: JSON.stringify({
                projectId: project_id,
                prompts: dallePrompts,
                callbackUrl,
              }),
            });

            if (workerRes.ok) {
              const { jobId } = await workerRes.json();
              console.log(`[prepare] image_generation routed to worker — job ${jobId}, ${dallePrompts.length} prompts`);
              return NextResponse.json({
                success: true,
                data: { needs_llm: false, routed_to_worker: true, step, project_id, jobId },
              });
            } else {
              const errText = await workerRes.text();
              console.error(`[prepare] Worker /generate-images failed: ${errText}`);
            }
          } catch (err) {
            console.error(`[prepare] Failed to reach worker for image_generation:`, err);
          }
        }
      }

      // Non-LLM step (voiceover, etc.) — run directly via Vercel
      return NextResponse.json({
        success: true,
        data: { needs_llm: false, step, project_id },
      });
    }

    // Resolve provider + API key
    const provider = profile?.llm_provider || settings.default_provider || settings.default_llm_provider || "anthropic";
    const model = profile?.llm_model || settings.default_model || settings.default_llm_model || "claude-sonnet-4-6";

    // Route long-running LLM steps to EC2 worker (no timeout constraint)
    const WORKER_ROUTED_STEPS = ["script_writing", "script_refinement", "visual_direction", "blend_curator", "timing_sync"];

    if (WORKER_ROUTED_STEPS.includes(step) && workerUrl && provider === "anthropic") {
      // Build callback URL — always use production URL to avoid Vercel deployment protection on preview URLs
      const callbackUrl = "https://mindarchive-hub.vercel.app/api/pipeline/step/llm-callback";

      try {
        const workerRes = await fetch(`${workerUrl}/llm`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(process.env.WORKER_SECRET ? { Authorization: `Bearer ${process.env.WORKER_SECRET}` } : {}),
          },
          body: JSON.stringify({
            step,
            projectId: project_id,
            system: prompt.system,
            prompt: prompt.user,
            maxTokens: prompt.maxTokens,
            model,
            callbackUrl,
          }),
        });

        if (!workerRes.ok) {
          const errText = await workerRes.text();
          console.error(`[prepare] Worker /llm failed: ${errText}`);
          // Fall through to normal streaming path
        } else {
          const { jobId } = await workerRes.json();
          console.log(`[prepare] Step ${step} routed to worker — job ${jobId}`);
          return NextResponse.json({
            success: true,
            data: {
              needs_llm: false,
              routed_to_worker: true,
              step,
              project_id,
              jobId,
            },
          });
        }
      } catch (err) {
        console.error(`[prepare] Failed to reach worker for ${step}:`, err);
        // Fall through to normal streaming path
      }
    }

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
