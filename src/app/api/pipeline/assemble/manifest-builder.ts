import type { Project, StepResult } from "@/types";

// ── Types matching worker/src/types.ts ──

export type SceneType = "DALLE" | "STOCK" | "RUNWAY" | "MOTION_GRAPHIC";
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

export interface DalleScene extends SceneBase {
  type: "DALLE";
  imageUrl: string;
  kenBurnsVariant: 0 | 1 | 2;
}

export interface StockScene extends SceneBase {
  type: "STOCK";
  videoUrl: string;
  sourceDuration: number;
}

export interface RunwayScene extends SceneBase {
  type: "RUNWAY";
  videoUrl: string;
  sourceDuration: number;
}

export interface MotionGraphicScene extends SceneBase {
  type: "MOTION_GRAPHIC";
  imageUrl?: string;
}

export type Scene = DalleScene | StockScene | RunwayScene | MotionGraphicScene;

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

function extractTagType(assetId: string): SceneType {
  const upper = assetId.toUpperCase();
  if (upper.startsWith("DALLE")) return "DALLE";
  if (upper.startsWith("STOCK")) return "STOCK";
  if (upper.startsWith("RUNWAY")) return "RUNWAY";
  if (upper.startsWith("MOTION_GRAPHIC") || upper.startsWith("MG_") || upper.startsWith("MG ")) return "MOTION_GRAPHIC";
  return "DALLE";
}

interface TimingEntry {
  scene: number;
  tag_type: SceneType;
  duration: number;
  label: string;
  start_time_seconds: number;
  end_time_seconds: number;
  transition_in: string;
  transition_out: string;
  visual_asset_id?: string;
}

function normaliseTimingEntries(raw: Record<string, unknown>[]): TimingEntry[] {
  return raw.map((entry, idx) => {
    const startTime = Number(entry.start_time_seconds) || 0;
    const endTime = Number(entry.end_time_seconds) || startTime;

    const scene = typeof entry.scene === "number" ? entry.scene : idx + 1;

    let tagType: SceneType = "DALLE";
    if (typeof entry.tag_type === "string" && ["DALLE", "STOCK", "RUNWAY", "MOTION_GRAPHIC"].includes(entry.tag_type)) {
      tagType = entry.tag_type as SceneType;
    } else if (typeof entry.visual_asset_id === "string") {
      tagType = extractTagType(entry.visual_asset_id);
    }

    const duration = Number(entry.duration) || (endTime - startTime) || 10;

    const label = (typeof entry.label === "string" ? entry.label : null)
      || (typeof entry.section === "string" ? entry.section : null)
      || `Scene ${scene}`;

    const visual_asset_id = typeof entry.visual_asset_id === "string" ? entry.visual_asset_id : undefined;

    return {
      scene,
      tag_type: tagType,
      duration,
      label,
      start_time_seconds: startTime,
      end_time_seconds: endTime,
      transition_in: typeof entry.transition_in === "string" ? entry.transition_in : "fade",
      transition_out: typeof entry.transition_out === "string" ? entry.transition_out : "dissolve",
      visual_asset_id,
    };
  });
}

/**
 * Match a visual_asset_id slug to the best DALL-E image by keyword overlap.
 * "DALLE_003_goku_notebook_field" → extract ["goku", "notebook", "field"]
 * then score each image's prompt/revised_prompt by how many keywords match.
 * Returns the best-matching image index, or -1 if no meaningful match.
 */
function matchDalleByAssetId(
  assetId: string,
  images: { url: string; prompt: string; revised_prompt: string }[],
  usedIndices: Set<number>
): number {
  if (!assetId || images.length === 0) return -1;

  // Extract slug: "DALLE_003_goku_notebook_field" → "goku notebook field"
  const slug = assetId
    .replace(/^(DALLE|STOCK|RUNWAY|MOTION_GRAPHIC|MG)[_\s]*\d*/i, "")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();

  if (!slug) return -1;

  const keywords = slug.split(/\s+/).filter((w) => w.length > 2);
  if (keywords.length === 0) return -1;

  let bestIdx = -1;
  let bestScore = 0;

  for (let i = 0; i < images.length; i++) {
    const text = `${images[i].prompt} ${images[i].revised_prompt}`.toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      if (text.includes(kw)) score++;
    }
    // Prefer unused images, but allow reuse if nothing else matches
    const unusedBonus = usedIndices.has(i) ? 0 : 0.5;
    const totalScore = score + unusedBonus;
    if (totalScore > bestScore) {
      bestScore = totalScore;
      bestIdx = i;
    }
  }

  // Only return a match if at least one keyword matched
  return bestScore >= 1 ? bestIdx : -1;
}

// ── Manifest builder ──

export interface ManifestBuildResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  manifest: Record<string, any>;
  scenes: Scene[];
  warnings: string[];
  assetCounts: {
    dalleAvailable: number;
    dalleRequired: number;
    stockAvailable: number;
    stockRequired: number;
    runwayAvailable: number;
    runwayRequired: number;
    motionGraphicRequired: number;
  };
  error?: undefined;
}

export interface ManifestBuildError {
  error: string;
  manifest?: undefined;
  scenes?: undefined;
  warnings?: undefined;
  assetCounts?: undefined;
}

export function buildManifest(
  project: Project,
  steps: StepResult[]
): ManifestBuildResult | ManifestBuildError {
  const warnings: string[] = [];

  // ── Gather all step outputs ──
  const getOutput = (stepId: string) =>
    steps.find((s: StepResult) => s.step === stepId && s.status === "completed")
      ?.output as Record<string, unknown> | undefined;

  const voiceover = getOutput("voiceover_generation") as
    | { audio_url?: string; word_count?: number; estimated_duration_minutes?: number }
    | undefined;

  if (!voiceover?.audio_url) {
    return { error: "Voiceover audio not available. Re-run the Voiceover Generation step." };
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

  // ── Parse and normalise timing data ──
  let timingData: TimingEntry[] = [];
  if (timingSync?.timing) {
    const parsed = safeParse<Record<string, unknown>[]>(timingSync.timing);
    if (Array.isArray(parsed) && parsed.length > 0) {
      timingData = normaliseTimingEntries(parsed);
    }
  }

  // ── Build asset pools ──
  const dalleImages = imageGen?.images || [];

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

  const heroClips = (heroScenes?.scenes || []).filter((s) => s.video_url);

  // ── Count requirements from timing data ──
  const dalleRequired = timingData.filter((t) => t.tag_type === "DALLE").length;
  const stockRequired = timingData.filter((t) => t.tag_type === "STOCK").length;
  const runwayRequired = timingData.filter((t) => t.tag_type === "RUNWAY").length;
  const motionGraphicRequired = timingData.filter((t) => t.tag_type === "MOTION_GRAPHIC").length;

  if (dalleImages.length < dalleRequired) {
    warnings.push(`DALLE: ${dalleImages.length} images available but ${dalleRequired} required — images will repeat`);
  }
  if (stockClipPool.length === 0 && stockRequired > 0) {
    warnings.push(`STOCK: 0 clips available but ${stockRequired} required — will fall back to DALLE`);
  }
  if (heroClips.length === 0 && runwayRequired > 0) {
    warnings.push(`RUNWAY: 0 hero clips available but ${runwayRequired} required — will fall back to DALLE`);
  }
  if (!timingSync?.timing) {
    warnings.push("No timing data found — using fallback (even distribution of DALLE images)");
  }

  // ── Build scenes ──
  const scenes: Scene[] = [];
  let dalleIdx = 0;
  let stockIdx = 0;
  let heroIdx = 0;
  const usedDalleIndices = new Set<number>();
  const audioDuration = (voiceover.estimated_duration_minutes || 7) * 60;

  // Helper: pick the best DALL-E image for a timing entry
  const pickDalleImage = (entry: TimingEntry) => {
    // Try asset ID matching first
    if (entry.visual_asset_id && dalleImages.length > 0) {
      const matchIdx = matchDalleByAssetId(entry.visual_asset_id, dalleImages, usedDalleIndices);
      if (matchIdx >= 0) {
        usedDalleIndices.add(matchIdx);
        return dalleImages[matchIdx];
      }
    }
    // Fall back to positional cycling
    const img = dalleImages[dalleIdx % Math.max(dalleImages.length, 1)];
    dalleIdx++;
    return img;
  };

  if (timingData.length > 0) {
    for (const entry of timingData) {
      const sceneIndex = entry.scene;
      const startTime = entry.start_time_seconds;
      const endTime = entry.end_time_seconds;
      const transIn = parseTransition(entry.transition_in);
      const transOut = parseTransition(entry.transition_out);

      const base = { sceneIndex, startTime, endTime, label: entry.label, transitionIn: transIn, transitionOut: transOut };

      switch (entry.tag_type) {
        case "DALLE": {
          const img = pickDalleImage(entry);
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
            warnings.push(`Scene ${sceneIndex} (STOCK): no clip available, falling back to DALLE`);
            const img = pickDalleImage(entry);
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
              sourceDuration: 10,
            } as RunwayScene);
          } else {
            warnings.push(`Scene ${sceneIndex} (RUNWAY): no hero clip available, falling back to DALLE`);
            const img = pickDalleImage(entry);
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
            imageUrl: undefined,
          } as MotionGraphicScene);
          break;
        }

        default: {
          const img = pickDalleImage(entry);
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
    projectId: project.id,
    projectTitle: project.title,
    voiceover: {
      url: voiceover.audio_url!,
      durationMinutes: voiceover.estimated_duration_minutes || 7,
      wordCount: voiceover.word_count || 1000,
    },
    brandIntro: {
      logoUrl: undefined as string | undefined,
      musicUrl: undefined as string | undefined,
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

  return {
    manifest,
    scenes,
    warnings,
    assetCounts: {
      dalleAvailable: dalleImages.length,
      dalleRequired,
      stockAvailable: stockClipPool.length,
      stockRequired,
      runwayAvailable: heroClips.length,
      runwayRequired,
      motionGraphicRequired,
    },
  };
}
