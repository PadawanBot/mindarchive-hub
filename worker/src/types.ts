/**
 * Assembly Manifest V2 — Timeline-driven multi-source compositor types.
 *
 * The assembler consumes these types to build the final video from
 * DALL-E images, stock footage, Runway hero clips, and motion graphic PNGs.
 */

// ── Scene types ──

export type SceneType = "DALLE" | "STOCK" | "RUNWAY" | "MOTION_GRAPHIC";
export type TransitionType = "fade" | "dissolve" | "cut";

interface SceneBase {
  sceneIndex: number; // 1-based
  type: SceneType;
  startTime: number; // seconds from audio start
  endTime: number;
  label: string;
  transitionIn: TransitionType;
  transitionOut: TransitionType;
}

export interface DalleScene extends SceneBase {
  type: "DALLE";
  imageUrl: string;
  kenBurnsVariant: 0 | 1 | 2; // zoom-in, zoom-out, pan-right
}

export interface StockScene extends SceneBase {
  type: "STOCK";
  videoUrl: string;
  sourceDuration: number; // original clip length in seconds
}

export interface RunwayScene extends SceneBase {
  type: "RUNWAY";
  videoUrl: string;
  sourceDuration: number;
}

export interface MotionGraphicScene extends SceneBase {
  type: "MOTION_GRAPHIC";
  imageUrl?: string; // PNG still from pipeline — subtle zoom + fade
}

export type Scene = DalleScene | StockScene | RunwayScene | MotionGraphicScene;

// ── Motion graphics overlays ──

export interface LowerThird {
  text: string;
  startTime: number;
  endTime: number;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  bgColor: string;
}

export interface MotionGraphicsSpec {
  lowerThirds: LowerThird[];
}

// ── Brand intro ──

export interface BrandIntro {
  logoUrl?: string; // PNG logo image
  musicUrl?: string; // 8s brand music MP3
  duration: number; // seconds (default 8)
}

// ── Manifest V2 ──

export interface AssemblyManifestV2 {
  version: 2;
  projectId: string;
  projectTitle: string;

  voiceover: {
    url: string;
    durationMinutes: number;
    wordCount: number;
  };

  brandIntro: BrandIntro | null;
  scenes: Scene[];
  motionGraphics: MotionGraphicsSpec | null;

  brand: {
    primaryColor: string;
    lowerThirdFont: string;
    lowerThirdColor: string;
    lowerThirdBg: string;
  } | null;

  output: {
    landscape: { width: number; height: number };
    portrait: { width: number; height: number };
    fps: number;
    crf: number;
    preset: string;
  };

  supabaseUrl: string;
  supabaseKey: string;
}

// ── Result types ──

export interface AssemblyResultV2 {
  landscapeUrl: string;
  portraitUrl: string;
  durationSeconds: number;
  fileSizeBytes: number;
}
