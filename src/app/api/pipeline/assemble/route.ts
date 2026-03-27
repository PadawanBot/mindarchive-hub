import { NextResponse } from "next/server";
import { getById, getAllSettings, getStepsByProject } from "@/lib/store";
import type { Project, StepResult } from "@/types";

export const maxDuration = 15;

// ── Types matching worker/src/types.ts ──

type SceneType = "DALLE" | "STOCK" | "RUNWAY" | "MOTION_GRAPHIC";
type TransitionType = "fade" | "dissolve" | "cut";

interface SceneBase {
  sceneIndex: number;
  type: SceneType;
  startTime: number;
  endTime: number;
  label: string;
  transitionIn: TransitionType;
  transitionOut: TransitionType;
}

interface DalleScene extends SceneBase {
  type: "DALLE";
  imageUrl: string;
  kenBurnsVariant: 0 | 1 | 2;
}

interface StockScene extends SceneBase {
  type: "STOCK";
  videoUrl: string;
  sourceDuration: number;
}

interface RunwayScene extends SceneBase {
  type: "RUNWAY";
  videoUrl: string;
  sourceDuration: number;
}

interface MotionGraphicScene extends SceneBase {
  type: "MOTION_GRAPHIC";
  imageUrl?: string;
}

type Scene = DalleScene | StockScene | RunwayScene | MotionGraphicScene;

interface LowerThird {
  text: string;
  startTime: number;
  endTime: number;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  bgColor: string;
}

// ── Helpers ──

function parseTransition(t: string | undefined): TransitionType {
  if (t === "dissolve" || t === "fade" || t === "cut") return t;
  return "fade";
}

function safeParse<T>(json: string | undefined): T | null {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const { project_id } = await request.json();

    const project = await getById<Project>("projects", project_id);
    if (!project) {
      return NextResponse.json(
        { success: false, error: "Project not found" },
        { status: 404 }
      );
    }

    const steps = await getStepsByProject(project_id);
    const workerUrl = process.env.WORKER_URL;

    if (!workerUrl) {
      return NextResponse.json(
        {
          success: false,
          error:
            "WORKER_URL not configured. Deploy the video assembly worker and set the WORKER_URL env var.",
        },
        { status: 400 }
      );
    }

    // ── Gather all step outputs ──
    const getOutput = (stepId: string) =>
      steps.find((s: StepResult) => s.step === stepId && s.status === "completed")
        ?.output as Record<string, unknown> | undefined;

    const voiceover = getOutput("voiceover_generation") as
      | { audio_url?: string; word_count?: number; estimated_duration_minutes?: number }
      | undefined;

    if (!voiceover?.audio_url) {
      return NextResponse.json(
        {
          success: false,
          error: "Voiceover audio not available. Re-run the Voiceover Generation step.",
        },
        { status: 400 }
      );
    }

    const imageGen = getOutput("image_generation") as
      | { images?: { url: string; prompt: string; revised_prompt: string }[] }
      | undefined;

    const stockFootage = getOutput("stock_footage") as
      | {
          footage?: {
            query: string;
            videos: { id: number; url: string; file_url: string; thumbnail: string; duration: number }[];
          }[];
        }
      | undefined;

    const heroScenes = getOutput("hero_scenes") as
      | {
          scenes?: { section: string; promptText: string; taskId: string; video_url?: string }[];
        }
      | undefined;

    const timingSync = getOutput("timing_sync") as
      | { timing?: string }
      | undefined;

    const motionGraphics = getOutput("motion_graphics") as
      | { motion_specs?: string }
      | undefined;

    const brandAssets = getOutput("brand_assets") as
      | { brand?: string }
      | undefined;

    // ── Parse timing data ──
    interface TimingEntry {
      scene: number;
      tag_type: SceneType;
      duration: number;
      label: string;
      start_time_seconds: number;
      end_time_seconds: number;
      transition_in: string;
      transition_out: string;
    }

    let timingData: TimingEntry[] = [];
    if (timingSync?.timing) {
      const parsed = safeParse<TimingEntry[]>(timingSync.timing);
      if (Array.isArray(parsed)) timingData = parsed;
    }

    // ── Build asset pools ──
    const dalleImages = imageGen?.images || [];

    // Flatten stock clips into a pool
    const stockClipPool: { fileUrl: string; duration: number }[] = [];
    if (stockFootage?.footage) {
      for (const group of stockFootage.footage) {
        for (const v of group.videos || []) {
          if (v.file_url) {
            stockClipPool.push({ fileUrl: v.file_url, duration: v.duration });
          }
        }
      }
    }

    // Runway hero clips with completed video URLs
    const heroClips = (heroScenes?.scenes || []).filter((s) => s.video_url);

    // ── Build scenes ──
    const scenes: Scene[] = [];
    let dalleIdx = 0;
    let stockIdx = 0;
    let heroIdx = 0;
    const audioDuration = (voiceover.estimated_duration_minutes || 7) * 60;

    if (timingData.length > 0) {
      for (const entry of timingData) {
        const sceneIndex = entry.scene;
        const duration = entry.duration || (entry.end_time_seconds - entry.start_time_seconds);
        const startTime = entry.start_time_seconds;
        const endTime = entry.end_time_seconds;
        const transIn = parseTransition(entry.transition_in);
        const transOut = parseTransition(entry.transition_out);

        const base = { sceneIndex, startTime, endTime, label: entry.label, transitionIn: transIn, transitionOut: transOut };

        switch (entry.tag_type) {
          case "DALLE": {
            const img = dalleImages[dalleIdx % Math.max(dalleImages.length, 1)];
            dalleIdx++;
            scenes.push({
              ...base,
              type: "DALLE",
              imageUrl: img?.url || "",
              kenBurnsVariant: (sceneIndex % 3) as 0 | 1 | 2,
            } as DalleScene);
            break;
          }

          case "STOCK": {
            const clip = stockClipPool[stockIdx % Math.max(stockClipPool.length, 1)];
            stockIdx++;
            if (clip?.fileUrl) {
              scenes.push({
                ...base,
                type: "STOCK",
                videoUrl: clip.fileUrl,
                sourceDuration: clip.duration,
              } as StockScene);
            } else {
              // Fallback to DALLE
              const img = dalleImages[dalleIdx % Math.max(dalleImages.length, 1)];
              dalleIdx++;
              scenes.push({
                ...base,
                type: "DALLE",
                imageUrl: img?.url || "",
                kenBurnsVariant: (sceneIndex % 3) as 0 | 1 | 2,
              } as DalleScene);
            }
            break;
          }

          case "RUNWAY": {
            const hero = heroClips[heroIdx];
            heroIdx++;
            if (hero?.video_url) {
              scenes.push({
                ...base,
                type: "RUNWAY",
                videoUrl: hero.video_url,
                sourceDuration: 10, // Runway clips are typically 5-10s
              } as RunwayScene);
            } else {
              // Fallback to DALLE
              const img = dalleImages[dalleIdx % Math.max(dalleImages.length, 1)];
              dalleIdx++;
              scenes.push({
                ...base,
                type: "DALLE",
                imageUrl: img?.url || "",
                kenBurnsVariant: (sceneIndex % 3) as 0 | 1 | 2,
              } as DalleScene);
            }
            break;
          }

          case "MOTION_GRAPHIC": {
            scenes.push({
              ...base,
              type: "MOTION_GRAPHIC",
              imageUrl: undefined, // PNG from assets table, if uploaded
            } as MotionGraphicScene);
            break;
          }

          default: {
            // Unknown tag_type — treat as DALLE
            const img = dalleImages[dalleIdx % Math.max(dalleImages.length, 1)];
            dalleIdx++;
            scenes.push({
              ...base,
              type: "DALLE",
              imageUrl: img?.url || "",
              kenBurnsVariant: (sceneIndex % 3) as 0 | 1 | 2,
            } as DalleScene);
          }
        }
      }
    } else {
      // Fallback: distribute DALL-E images evenly across audio duration
      const images = dalleImages.length > 0 ? dalleImages : [{ url: "" }];
      const segDuration = audioDuration / images.length;
      for (let i = 0; i < images.length; i++) {
        scenes.push({
          sceneIndex: i + 1,
          type: "DALLE",
          startTime: i * segDuration,
          endTime: (i + 1) * segDuration,
          label: `Scene ${i + 1}`,
          transitionIn: i === 0 ? "fade" : "dissolve",
          transitionOut: "dissolve",
          imageUrl: images[i].url || "",
          kenBurnsVariant: (i % 3) as 0 | 1 | 2,
        } as DalleScene);
      }
    }

    // ── Parse motion graphics for lower thirds ──
    let lowerThirds: LowerThird[] = [];
    if (motionGraphics?.motion_specs) {
      const parsed = safeParse<{
        lower_thirds?: {
          text: string;
          start_time_seconds: number;
          end_time_seconds: number;
          x?: number;
          y?: number;
          font_size?: number;
          color?: string;
          bg_color?: string;
        }[];
      }>(motionGraphics.motion_specs);
      if (parsed?.lower_thirds) {
        lowerThirds = parsed.lower_thirds.map((lt) => ({
          text: lt.text,
          startTime: lt.start_time_seconds,
          endTime: lt.end_time_seconds,
          x: lt.x || 100,
          y: lt.y || 900,
          fontSize: lt.font_size || 36,
          color: lt.color || "white",
          bgColor: lt.bg_color || "black@0.6",
        }));
      }
    }

    // ── Parse brand assets ──
    let brand = null;
    if (brandAssets?.brand) {
      const parsed = safeParse<{
        color_palette?: { hex: string; usage: string }[];
        lower_third_style?: { font?: string; color?: string; bg_color?: string };
      }>(brandAssets.brand as string);
      if (parsed) {
        const primary = parsed.color_palette?.find((c) =>
          c.usage?.toLowerCase().includes("primary")
        );
        brand = {
          primaryColor: primary?.hex || "#0D0D1A",
          lowerThirdFont: parsed.lower_third_style?.font || "sans-serif",
          lowerThirdColor: parsed.lower_third_style?.color || "white",
          lowerThirdBg: parsed.lower_third_style?.bg_color || "black@0.6",
        };
      }
    }

    // ── Build v2 manifest ──
    const manifest = {
      version: 2 as const,
      projectId: project_id,
      projectTitle: project.title,
      voiceover: {
        url: voiceover.audio_url!,
        durationMinutes: voiceover.estimated_duration_minutes || 7,
        wordCount: voiceover.word_count || 1000,
      },
      brandIntro: {
        logoUrl: undefined as string | undefined, // TODO: populate from brand assets or channel profile
        musicUrl: undefined as string | undefined, // TODO: populate from brand assets or channel profile
        duration: 8,
      },
      scenes,
      motionGraphics: lowerThirds.length > 0 ? { lowerThirds } : null,
      brand,
      output: {
        landscape: { width: 1920, height: 1080 },
        portrait: { width: 1080, height: 1920 },
        fps: 25,
        crf: 18,
        preset: "fast",
      },
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || "",
      supabaseKey: process.env.SUPABASE_SECRET_KEY || "",
    };

    // ── Send to worker ──
    const callbackUrl = `${request.headers.get("origin") || ""}/api/pipeline/assemble/callback`;
    const workerRes = await fetch(`${workerUrl}/assemble`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.WORKER_SECRET
          ? { Authorization: `Bearer ${process.env.WORKER_SECRET}` }
          : {}),
      },
      body: JSON.stringify({ manifest, callbackUrl }),
    });

    if (!workerRes.ok) {
      const errText = await workerRes.text();
      return NextResponse.json(
        { success: false, error: `Worker error: ${errText}` },
        { status: 500 }
      );
    }

    const { jobId } = await workerRes.json();

    return NextResponse.json({
      success: true,
      data: {
        jobId,
        workerUrl,
        status: "queued",
        sceneCount: scenes.length,
        assetTypes: {
          dalle: scenes.filter((s) => s.type === "DALLE").length,
          stock: scenes.filter((s) => s.type === "STOCK").length,
          runway: scenes.filter((s) => s.type === "RUNWAY").length,
          motionGraphic: scenes.filter((s) => s.type === "MOTION_GRAPHIC").length,
        },
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
