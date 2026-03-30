import { NextResponse } from "next/server";
import { getById, update, getAllSettings, upsertStep, getStepsByProject } from "@/lib/store";
import { buildPrompt } from "@/lib/pipeline/prompts";
import { getStepDef, canRunStep, getNextStep } from "@/lib/pipeline/steps";
import { deleteAssetsByStep } from "@/lib/asset-db";
import type { Project, ChannelProfile, FormatPreset, PipelineStep, SceneImage, SceneVideo } from "@/types";
import { parseDalleScenes, parseRunwayScenes } from "@/lib/pipeline/parse-visual-scenes";

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

    // Route timing_sync to EC2 worker's audio-driven timing endpoint BEFORE prompt building
    // Gold standard: ffmpeg silencedetect on actual voiceover MP3, not LLM word-count estimation
    if (step === "timing_sync" && workerUrl) {
      const callbackUrl = "https://mindarchive-hub.vercel.app/api/pipeline/step/llm-callback";

      // Get voiceover URL from previous step
      const voiceoverStep = existingSteps.find(s => s.step === "voiceover_generation" && s.status === "completed");
      const voiceoverOutput = voiceoverStep?.output as { audio_url?: string } | undefined;
      const voiceoverUrl = voiceoverOutput?.audio_url;

      // Get visual direction scenes array
      const visualStep = existingSteps.find(s => s.step === "visual_direction" && s.status === "completed");
      const visualOutput = (visualStep?.output as { visuals?: string })?.visuals || "";
      let scenes: Record<string, unknown>[] = [];
      try {
        let cleaned = visualOutput.trim();
        if (cleaned.startsWith("```")) {
          cleaned = cleaned.replace(/^```(?:json|JSON)?\s*\n?/, "").replace(/\n?```\s*$/, "");
        }
        const parsed = JSON.parse(cleaned);
        scenes = Array.isArray(parsed) ? parsed : (parsed.scenes || parsed.data || []);
      } catch {
        console.error("[prepare] Failed to parse visual direction scenes for timing_sync");
      }

      if (voiceoverUrl && scenes.length > 0) {
        try {
          const workerRes = await fetch(`${workerUrl}/timing-from-audio`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(process.env.WORKER_SECRET ? { Authorization: `Bearer ${process.env.WORKER_SECRET}` } : {}),
            },
            body: JSON.stringify({
              projectId: project_id,
              voiceoverUrl,
              scenes,
              callbackUrl,
            }),
          });

          if (workerRes.ok) {
            const { jobId } = await workerRes.json();
            console.log(`[prepare] timing_sync routed to worker /timing-from-audio — job ${jobId}, ${scenes.length} scenes, audio: ${voiceoverUrl}`);
            return NextResponse.json({
              success: true,
              data: { needs_llm: false, routed_to_worker: true, step, project_id, jobId },
            });
          } else {
            const errText = await workerRes.text();
            console.error(`[prepare] Worker /timing-from-audio failed: ${errText}`);
            // Fall through to LLM-based timing as fallback
          }
        } catch (err) {
          console.error(`[prepare] Failed to reach worker for timing-from-audio:`, err);
        }
      } else {
        console.warn(`[prepare] timing_sync: missing voiceover (${!!voiceoverUrl}) or scenes (${scenes.length}) — falling back to LLM`);
      }
    }

    // Build prompt for this step
    const prompt = buildPrompt(step as PipelineStep, { project, profile, format, previousSteps: existingSteps, settings });

    if (!prompt) {
      // Route image_generation to EC2 worker (DALL-E calls exceed Vercel 60s timeout)
      if (step === "image_generation" && workerUrl) {
        const callbackUrl = "https://mindarchive-hub.vercel.app/api/pipeline/step/llm-callback";

        // Extract DALL-E scenes from visual direction using shared parser
        const visualStep = existingSteps.find(s => s.step === "visual_direction");
        const visuals = (visualStep?.output as { visuals?: string })?.visuals || "";
        const allScenes = parseDalleScenes(visuals);

        // Resume: check existing step output for completed scenes
        const imageStep = existingSteps.find(s => s.step === "image_generation");
        const imageOutput = imageStep?.output as { scenes?: SceneImage[]; images?: { url: string; prompt: string; revised_prompt?: string }[] } | undefined;
        const existingScenes = imageOutput?.scenes || [];
        const completedMap = new Map(
          existingScenes.filter(s => s.status === "completed" && s.image_url).map(s => [s.scene_id, s])
        );

        // Also check legacy images[] — match by prompt text to recover completed scenes
        if (completedMap.size === 0 && imageOutput?.images?.length) {
          const legacyImages = imageOutput.images;
          for (const scene of allScenes) {
            const match = legacyImages.find(img => img.prompt.trim() === scene.prompt.trim());
            if (match) {
              completedMap.set(scene.scene_id, {
                ...scene, status: "completed", image_url: match.url, revised_prompt: match.revised_prompt || null,
              });
            }
          }
        }

        // Merge: carry forward completed scenes, mark rest as pending
        const mergedScenes: SceneImage[] = allScenes.map(scene => {
          const existing = completedMap.get(scene.scene_id);
          return existing ? { ...scene, ...existing } : scene;
        });
        const pendingScenes = mergedScenes.filter(s => s.status !== "completed");

        if (allScenes.length > 0 && pendingScenes.length === 0) {
          console.log(`[prepare] image_generation: all ${allScenes.length} scenes already completed — skipping worker`);
          return NextResponse.json({
            success: true,
            data: { needs_llm: false, already_complete: true, step, project_id },
          });
        }

        if (allScenes.length > 0) {
          try {
            const workerRes = await fetch(`${workerUrl}/generate-images`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(process.env.WORKER_SECRET ? { Authorization: `Bearer ${process.env.WORKER_SECRET}` } : {}),
              },
              body: JSON.stringify({
                projectId: project_id,
                scenes: pendingScenes,
                allScenes: mergedScenes,
                prompts: pendingScenes.map(s => s.prompt), // backwards compat
                callbackUrl,
              }),
            });

            if (workerRes.ok) {
              const { jobId } = await workerRes.json();
              console.log(`[prepare] image_generation routed to worker — job ${jobId}, ${pendingScenes.length} pending of ${allScenes.length} total`);
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

      // Route voiceover_generation to EC2 worker (ElevenLabs streaming exceeds Vercel 60s timeout)
      if (step === "voiceover_generation" && workerUrl) {
        const elevenLabsKey = settings.elevenlabs_key;
        const voiceId = profile?.voice_id;
        if (!elevenLabsKey || !voiceId) {
          return NextResponse.json({
            success: true,
            data: { needs_llm: false, step, project_id },
          });
        }

        const callbackUrl = "https://mindarchive-hub.vercel.app/api/pipeline/step/llm-callback";

        // Extract narration text from refined or raw script
        const refinedStep = existingSteps.find(s => s.step === "script_refinement");
        const scriptStep = existingSteps.find(s => s.step === "script_writing");
        const scriptText = (refinedStep?.output as { refined_script?: string })?.refined_script
          || (scriptStep?.output as { script?: string })?.script || "";

        // Strip visual tags and section headers — narration only
        const narration = scriptText
          .replace(/\[(DALLE|RUNWAY|STOCK|MOTION_GRAPHIC|VISUAL CUE)[:\s][^\]]*\]/gi, "")
          .replace(/^#{1,3}\s.*$/gm, "")
          .replace(/^---+$/gm, "")
          .replace(/\*\*([^*]+)\*\*/g, "$1")   // strip bold markdown
          .replace(/\*([^*]+)\*/g, "$1")        // strip italic markdown
          .replace(/\n{3,}/g, "\n\n")
          .trim();

        if (narration.length > 0) {
          try {
            const workerRes = await fetch(`${workerUrl}/generate-voiceover`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(process.env.WORKER_SECRET ? { Authorization: `Bearer ${process.env.WORKER_SECRET}` } : {}),
              },
              body: JSON.stringify({
                projectId: project_id,
                text: narration,
                voiceId,
                modelId: "eleven_multilingual_v2",
                voiceSettings: {
                  stability: 0.5,
                  similarity_boost: 0.75,
                  style: 0.5,
                  use_speaker_boost: true,
                },
                elevenLabsKey: elevenLabsKey,
                callbackUrl,
              }),
            });

            if (workerRes.ok) {
              const { jobId } = await workerRes.json();
              console.log(`[prepare] voiceover_generation routed to worker — job ${jobId}, ${narration.length} chars`);
              return NextResponse.json({
                success: true,
                data: { needs_llm: false, routed_to_worker: true, step, project_id, jobId },
              });
            } else {
              const errText = await workerRes.text();
              console.error(`[prepare] Worker /generate-voiceover failed: ${errText}`);
            }
          } catch (err) {
            console.error(`[prepare] Failed to reach worker for voiceover_generation:`, err);
          }
        }
      }

      // Route hero_scenes to EC2 worker (Runway polling exceeds Vercel 60s timeout)
      if (step === "hero_scenes" && workerUrl) {
        const runwayKey = settings.runway_key;
        if (runwayKey) {
          const callbackUrl = "https://mindarchive-hub.vercel.app/api/pipeline/step/llm-callback";

          // Extract RUNWAY scenes from visual direction using shared parser
          const visualStep = existingSteps.find(s => s.step === "visual_direction");
          const visuals = (visualStep?.output as { visuals?: string })?.visuals || "";
          const allScenes = parseRunwayScenes(visuals);

          // Fallback: extract from script if no RUNWAY tags in visual direction
          if (allScenes.length === 0) {
            const scriptStep = existingSteps.find(s => s.step === "script_refinement" || s.step === "script_writing");
            const script = (scriptStep?.output as { refined_script?: string; script?: string })?.refined_script
              || (scriptStep?.output as { script?: string })?.script || "";
            const runwayMatches = script.match(/\[RUNWAY:\s*([^\]]+)\]/gi) || [];
            runwayMatches.slice(0, 5).forEach((m, i) => {
              allScenes.push({
                scene_id: i + 1,
                label: `Hero Scene ${i + 1}`,
                prompt: m.replace(/\[RUNWAY:\s*/i, "").replace(/\]$/, "").trim(),
                video_url: null, task_id: null, status: "pending",
              });
            });
          }

          // Resume: check existing step output for completed scenes
          const heroStep = existingSteps.find(s => s.step === "hero_scenes");
          const heroOutput = heroStep?.output as { scenes?: SceneVideo[] } | undefined;
          const existingHeroScenes = heroOutput?.scenes || [];
          const completedHeroMap = new Map(
            existingHeroScenes.filter(s => s.status === "completed" && s.video_url).map(s => [s.scene_id, s])
          );

          // Also check legacy format — match by prompt text
          if (completedHeroMap.size === 0 && Array.isArray(heroOutput?.scenes)) {
            const legacyScenes = heroOutput!.scenes as unknown as { section?: string; promptText?: string; video_url?: string }[];
            for (const scene of allScenes) {
              const match = legacyScenes.find(ls => ls.video_url && (ls.promptText?.trim() === scene.prompt.trim()));
              if (match) {
                completedHeroMap.set(scene.scene_id, { ...scene, status: "completed", video_url: match.video_url! });
              }
            }
          }

          // Merge completed scenes
          const mergedScenes: SceneVideo[] = allScenes.map(scene => {
            const existing = completedHeroMap.get(scene.scene_id);
            return existing ? { ...scene, ...existing } : scene;
          });
          const pendingScenes = mergedScenes.filter(s => s.status !== "completed");

          if (allScenes.length > 0 && pendingScenes.length === 0) {
            console.log(`[prepare] hero_scenes: all ${allScenes.length} scenes already completed — skipping worker`);
            return NextResponse.json({
              success: true,
              data: { needs_llm: false, already_complete: true, step, project_id },
            });
          }

          if (allScenes.length > 0) {
            try {
              const workerRes = await fetch(`${workerUrl}/generate-hero-scenes`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  ...(process.env.WORKER_SECRET ? { Authorization: `Bearer ${process.env.WORKER_SECRET}` } : {}),
                },
                body: JSON.stringify({
                  projectId: project_id,
                  scenes: pendingScenes.map(s => ({ scene_id: s.scene_id, section: s.label, promptText: s.prompt })),
                  allScenes: mergedScenes,
                  runwayKey,
                  callbackUrl,
                }),
              });

              if (workerRes.ok) {
                const { jobId } = await workerRes.json();
                console.log(`[prepare] hero_scenes routed to worker — job ${jobId}, ${pendingScenes.length} pending of ${allScenes.length} total`);
                return NextResponse.json({
                  success: true,
                  data: { needs_llm: false, routed_to_worker: true, step, project_id, jobId },
                });
              } else {
                const errText = await workerRes.text();
                console.error(`[prepare] Worker /generate-hero-scenes failed: ${errText}`);
              }
            } catch (err) {
              console.error(`[prepare] Failed to reach worker for hero_scenes:`, err);
            }
          }
        }
      }

      // Non-LLM step (motion_graphics, stock_footage, etc.) — run directly via Vercel
      return NextResponse.json({
        success: true,
        data: { needs_llm: false, step, project_id },
      });
    }

    // Resolve provider + API key
    const provider = profile?.llm_provider || settings.default_provider || settings.default_llm_provider || "anthropic";
    const model = profile?.llm_model || settings.default_model || settings.default_llm_model || "claude-sonnet-4-6";

    // Route long-running LLM steps to EC2 worker (no timeout constraint)
    const WORKER_ROUTED_STEPS = ["script_writing", "script_refinement", "visual_direction", "blend_curator"];

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
