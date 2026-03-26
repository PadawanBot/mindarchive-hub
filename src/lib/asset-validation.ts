/**
 * Asset slot definitions and validation rules for manual asset management.
 * Defines what assets each pipeline step can hold and their constraints.
 */
import type { PipelineStep } from "@/types";

export interface AssetSlotDef {
  step: PipelineStep;
  slotKey: string;           // Output field path e.g. "images[0].url", "audio_url"
  label: string;
  mimeCategory: "image" | "audio" | "video";
  acceptMimeTypes: string[];
  maxSizeBytes: number;
  dimensions?: { minW: number; minH: number; maxW: number; maxH: number };
  maxDurationMs?: number;
}

export interface FileValidation {
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  durationMs?: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ─── Slot definitions per step ───

const imageSlots: AssetSlotDef[] = Array.from({ length: 5 }, (_, i) => ({
  step: "image_generation" as PipelineStep,
  slotKey: `images[${i}].url`,
  label: `Scene ${i + 1} Image`,
  mimeCategory: "image" as const,
  acceptMimeTypes: ["image/png", "image/jpeg", "image/webp"],
  maxSizeBytes: 10 * 1024 * 1024,
  dimensions: { minW: 512, minH: 512, maxW: 4096, maxH: 4096 },
}));

const heroSceneSlots: AssetSlotDef[] = Array.from({ length: 2 }, (_, i) => ({
  step: "hero_scenes" as PipelineStep,
  slotKey: `scenes[${i}].video_url`,
  label: `Hero Scene ${i + 1}`,
  mimeCategory: "video" as const,
  acceptMimeTypes: ["video/mp4", "video/quicktime", "video/webm"],
  maxSizeBytes: 100 * 1024 * 1024,
  maxDurationMs: 30 * 1000,
}));

const stockFootageSlots: AssetSlotDef[] = Array.from({ length: 5 }, (_, i) => ({
  step: "stock_footage" as PipelineStep,
  slotKey: `stock_clips[${i}].url`,
  label: `Stock Clip ${i + 1}`,
  mimeCategory: "video" as const,
  acceptMimeTypes: ["video/mp4", "video/quicktime", "video/webm"],
  maxSizeBytes: 100 * 1024 * 1024,
  maxDurationMs: 60 * 1000,
}));

export const ASSET_SLOT_DEFS: Partial<Record<PipelineStep, AssetSlotDef[]>> = {
  voiceover_generation: [{
    step: "voiceover_generation",
    slotKey: "audio_url",
    label: "Voiceover MP3",
    mimeCategory: "audio",
    acceptMimeTypes: ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav"],
    maxSizeBytes: 50 * 1024 * 1024,
    maxDurationMs: 30 * 60 * 1000,
  }],
  image_generation: imageSlots,
  stock_footage: stockFootageSlots,
  thumbnail_creation: [{
    step: "thumbnail_creation",
    slotKey: "thumbnail_url",
    label: "Thumbnail Image",
    mimeCategory: "image",
    acceptMimeTypes: ["image/png", "image/jpeg"],
    maxSizeBytes: 5 * 1024 * 1024,
    dimensions: { minW: 1280, minH: 720, maxW: 2560, maxH: 1440 },
  }],
  hero_scenes: heroSceneSlots,
};

/**
 * Get all slot definitions for a pipeline step.
 */
export function getSlotsForStep(step: string): AssetSlotDef[] {
  return ASSET_SLOT_DEFS[step as PipelineStep] || [];
}

/**
 * Get a specific slot definition by step and slot key.
 */
export function getSlotDef(step: string, slotKey: string): AssetSlotDef | undefined {
  const slots = getSlotsForStep(step);
  return slots.find((s) => s.slotKey === slotKey);
}

/**
 * Validate a file against a slot definition.
 */
export function validateFile(file: FileValidation, slotDef: AssetSlotDef): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Mime type check
  if (!slotDef.acceptMimeTypes.includes(file.mimeType)) {
    errors.push(
      `File type "${file.mimeType}" not accepted. Expected: ${slotDef.acceptMimeTypes.join(", ")}`
    );
  }

  // Size check
  if (file.sizeBytes > slotDef.maxSizeBytes) {
    const maxMB = Math.round(slotDef.maxSizeBytes / (1024 * 1024));
    const fileMB = (file.sizeBytes / (1024 * 1024)).toFixed(1);
    errors.push(`File too large (${fileMB}MB). Maximum: ${maxMB}MB`);
  }

  // Dimension checks (images)
  if (slotDef.dimensions && file.width && file.height) {
    const { minW, minH, maxW, maxH } = slotDef.dimensions;
    if (file.width < minW || file.height < minH) {
      errors.push(`Image too small (${file.width}x${file.height}). Minimum: ${minW}x${minH}`);
    }
    if (file.width > maxW || file.height > maxH) {
      warnings.push(`Image very large (${file.width}x${file.height}). Recommended max: ${maxW}x${maxH}`);
    }
  }

  // Duration check (audio/video)
  if (slotDef.maxDurationMs && file.durationMs && file.durationMs > slotDef.maxDurationMs) {
    const maxSec = Math.round(slotDef.maxDurationMs / 1000);
    const fileSec = Math.round(file.durationMs / 1000);
    errors.push(`Duration too long (${fileSec}s). Maximum: ${maxSec}s`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Get the file extension for a mime type.
 */
export function extForMime(mimeType: string): string {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
  };
  return map[mimeType] || "bin";
}

/**
 * Generate a storage filename for a manual upload.
 */
export function storageFilename(step: string, slotKey: string, mimeType: string): string {
  // "images[2].url" → "images_2"
  const sanitized = slotKey.replace(/\[/g, "_").replace(/\]/g, "").replace(/\.url$/, "").replace(/\./g, "_");
  return `${step}_${sanitized}.${extForMime(mimeType)}`;
}
