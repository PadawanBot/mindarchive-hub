"use client";

import type { PipelineStep } from "@/types";
import { AssetGrid } from "@/components/assets/AssetGrid";
import { getSlotsForStep } from "@/lib/asset-validation";
import { ImageGallery } from "./outputs/ImageGallery";
import { SceneImagePanel } from "./outputs/SceneImagePanel";
import { AudioPlayer } from "./outputs/AudioPlayer";
import { StockFootageGrid } from "./outputs/StockFootageGrid";
import { HeroScenesViewer } from "./outputs/HeroScenesViewer";
import { SceneVideoPanel } from "./outputs/SceneVideoPanel";
import { TextOutput } from "./outputs/TextOutput";
import { VisualDirectionOutput } from "./outputs/VisualDirectionOutput";

interface StepOutputRendererProps {
  step: string;
  label: string;
  text: string;
  output: Record<string, unknown>;
  projectId: string;
  onOutputChanged: () => void;
}

export function StepOutputRenderer({ step, label, text, output, projectId, onOutputChanged }: StepOutputRendererProps) {
  // Stock footage handles its own asset slots internally — no separate AssetGrid needed
  const showSeparateAssetGrid = step !== "stock_footage" && output && getSlotsForStep(step).length > 0;

  return (
    <div>
      <h3 className="text-sm font-semibold text-muted-foreground mb-2">{label}</h3>

      {/* Image Generation — scene panel (new) or flat gallery (legacy) */}
      {step === "image_generation" && output?.scenes && Array.isArray(output.scenes) ? (
        <SceneImagePanel scenes={output.scenes as import("@/types").SceneImage[]} projectId={projectId} onScenesChanged={onOutputChanged} />
      ) : step === "image_generation" ? (
        <ImageGallery output={output} projectId={projectId} />
      ) : step === "motion_graphic_cards" && output?.scenes && Array.isArray(output.scenes) ? (
        /* Motion Graphic Cards — pre-rendered PNG cards */
        <SceneImagePanel scenes={output.scenes as import("@/types").SceneImage[]} projectId={projectId} onScenesChanged={onOutputChanged} />
      ) : step === "thumbnail_generation" && output?.scenes && Array.isArray(output.scenes) ? (
        /* Thumbnail Generation — DALL-E rendered thumbnail images */
        <SceneImagePanel scenes={output.scenes as import("@/types").SceneImage[]} projectId={projectId} onScenesChanged={onOutputChanged} />
      ) : step === "voiceover_generation" && output ? (
        /* Voiceover — show audio player if URL available */
        <AudioPlayer output={output} />
      ) : step === "stock_footage" && output?.footage && Array.isArray(output.footage) ? (
        /* Stock Footage — unified search results + slot management */
        <StockFootageGrid output={output} projectId={projectId} onOutputChanged={onOutputChanged} />
      ) : step === "hero_scenes" && output?.scenes && Array.isArray(output.scenes) && (output.scenes as Record<string, unknown>[])[0]?.scene_id != null ? (
        /* Hero Scenes — scene-mapped panel (new format with scene_id) */
        <SceneVideoPanel scenes={output.scenes as import("@/types").SceneVideo[]} projectId={projectId} onScenesChanged={onOutputChanged} />
      ) : step === "hero_scenes" && output?.scenes && Array.isArray(output.scenes) ? (
        /* Hero Scenes — legacy viewer */
        <HeroScenesViewer
          scenes={output.scenes as { task_id?: string; taskId?: string; status?: string; video_url?: string; image_url?: string; imageUrl?: string; prompt?: string; promptText?: string }[]}
          skipped={output.status === "skipped"}
          reason={typeof output.reason === "string" ? output.reason : undefined}
          projectId={projectId}
        />
      ) : step === "visual_direction" ? (
        /* Visual Direction — two-tab: doc + scene JSON */
        <VisualDirectionOutput text={text} />
      ) : (
        /* Default — pre-formatted text */
        <TextOutput text={text} />
      )}

      {/* Asset management grid — for non-stock-footage asset-producing steps */}
      {showSeparateAssetGrid && (
        <div className="mt-3 pt-3 border-t border-muted-foreground/10">
          <AssetGrid
            projectId={projectId}
            step={step as PipelineStep}
            output={output}
            onOutputChanged={onOutputChanged}
          />
        </div>
      )}
    </div>
  );
}
