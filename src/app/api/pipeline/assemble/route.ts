import { NextResponse } from "next/server";
import { getById, getAllSettings, getStepsByProject } from "@/lib/store";
import type { Project, StepResult } from "@/types";

export const maxDuration = 15;

export async function POST(request: Request) {
  try {
    const { project_id } = await request.json();

    const project = await getById<Project>("projects", project_id);
    if (!project) {
      return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
    }

    const steps = await getStepsByProject(project_id);
    const settings = await getAllSettings();
    const workerUrl = process.env.WORKER_URL;

    if (!workerUrl) {
      return NextResponse.json({ success: false, error: "WORKER_URL not configured. Deploy the video assembly worker on Railway and set the WORKER_URL env var." }, { status: 400 });
    }

    // Gather all assets from completed steps
    const getOutput = (stepId: string) =>
      steps.find(s => s.step === stepId && s.status === "completed")?.output;

    const voiceover = getOutput("voiceover_generation") as { audio_url?: string; word_count?: number; estimated_duration_minutes?: number } | undefined;
    const imageGen = getOutput("image_generation") as { images?: { url: string; prompt: string; revised_prompt: string }[] } | undefined;
    const timingSync = getOutput("timing_sync") as { timing?: string } | undefined;
    const brandAssets = getOutput("brand_assets") as { brand?: string } | undefined;
    const motionGraphics = getOutput("motion_graphics") as { motion_specs?: string } | undefined;

    if (!voiceover?.audio_url) {
      return NextResponse.json({ success: false, error: "Voiceover audio not available. Re-run the Voiceover Generation step." }, { status: 400 });
    }

    // Build timing-based scenes from timing sync data
    const scenes: { imageUrl: string; startTime: number; endTime: number; transition: string }[] = [];
    const images = imageGen?.images || [];

    // Try to parse timing data for scene timestamps
    let timingData: { start_time_seconds: number; end_time_seconds: number }[] = [];
    if (timingSync?.timing) {
      try {
        const parsed = JSON.parse(timingSync.timing);
        timingData = Array.isArray(parsed) ? parsed : [];
      } catch {}
    }

    // Map images to timing segments (or distribute evenly)
    if (images.length > 0) {
      const audioDuration = (voiceover.estimated_duration_minutes || 7) * 60;

      if (timingData.length > 0) {
        // Use timing sync data
        for (let i = 0; i < timingData.length; i++) {
          const imgIdx = i % images.length;
          scenes.push({
            imageUrl: images[imgIdx].url,
            startTime: timingData[i].start_time_seconds,
            endTime: timingData[i].end_time_seconds,
            transition: i === 0 ? "fade" : "dissolve",
          });
        }
      } else {
        // Distribute images evenly across audio duration
        const segmentDuration = audioDuration / images.length;
        for (let i = 0; i < images.length; i++) {
          scenes.push({
            imageUrl: images[i].url,
            startTime: i * segmentDuration,
            endTime: (i + 1) * segmentDuration,
            transition: i === 0 ? "fade" : "dissolve",
          });
        }
      }
    }

    // Parse motion graphics for lower thirds
    let motionSpecs: { lowerThirds?: { text: string; startTime: number; endTime: number }[] } | undefined;
    if (motionGraphics?.motion_specs) {
      try {
        const parsed = JSON.parse(motionGraphics.motion_specs);
        motionSpecs = { lowerThirds: parsed.lower_thirds };
      } catch {}
    }

    // Build assembly manifest
    const manifest = {
      projectId: project_id,
      projectTitle: project.title,
      voiceover: {
        url: voiceover.audio_url,
        durationMinutes: voiceover.estimated_duration_minutes || 7,
        wordCount: voiceover.word_count || 1000,
      },
      scenes,
      motionGraphics: motionSpecs,
      resolution: { width: 1920, height: 1080 },
      fps: 30,
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || "",
      supabaseKey: process.env.SUPABASE_SECRET_KEY || "",
    };

    // Send to Railway worker
    const callbackUrl = `${request.headers.get("origin") || ""}/api/pipeline/assemble/callback`;
    const workerRes = await fetch(`${workerUrl}/assemble`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ manifest, callbackUrl }),
    });

    if (!workerRes.ok) {
      const errText = await workerRes.text();
      return NextResponse.json({ success: false, error: `Worker error: ${errText}` }, { status: 500 });
    }

    const { jobId } = await workerRes.json();

    return NextResponse.json({
      success: true,
      data: { jobId, workerUrl, status: "queued" },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
