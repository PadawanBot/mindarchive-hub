"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PipelineStep } from "@/types";
import { AssetGrid } from "@/components/assets/AssetGrid";
import { getSlotsForStep } from "@/lib/asset-validation";
import { ImageGallery } from "./outputs/ImageGallery";
import { AudioPlayer } from "./outputs/AudioPlayer";
import { StockFootageGrid } from "./outputs/StockFootageGrid";
import { HeroScenesViewer } from "./outputs/HeroScenesViewer";
import { TextOutput } from "./outputs/TextOutput";

interface StepOutputRendererProps {
  step: string;
  label: string;
  text: string;
  output: Record<string, unknown>;
  projectId: string;
  onOutputChanged: () => void;
}

export function StepOutputRenderer({ step, label, text, output, projectId, onOutputChanged }: StepOutputRendererProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-muted-foreground">{label}</h3>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs"
            onClick={() => window.open(`/api/export?project_id=${projectId}&steps=${step}&format=md`, '_blank')}>
            <Download className="h-3 w-3 mr-1" /> MD
          </Button>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs"
            onClick={() => window.open(`/api/export?project_id=${projectId}&steps=${step}&format=txt`, '_blank')}>
            TXT
          </Button>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs"
            onClick={() => window.open(`/api/export?project_id=${projectId}&steps=${step}&format=json`, '_blank')}>
            JSON
          </Button>
        </div>
      </div>

      {/* Image Generation — show thumbnails */}
      {step === "image_generation" && output?.images && Array.isArray(output.images) ? (
        <ImageGallery output={output} />
      ) : step === "voiceover_generation" && output ? (
        /* Voiceover — show audio player if URL available */
        <AudioPlayer output={output} />
      ) : step === "stock_footage" && output?.footage && Array.isArray(output.footage) ? (
        /* Stock Footage — show video thumbnails and links */
        <StockFootageGrid output={output} />
      ) : step === "hero_scenes" && output?.scenes && Array.isArray(output.scenes) ? (
        /* Hero Scenes — show video previews with Runway polling */
        <HeroScenesViewer
          scenes={output.scenes as { task_id?: string; taskId?: string; status?: string; video_url?: string; image_url?: string; imageUrl?: string; prompt?: string; promptText?: string }[]}
          skipped={output.status === "skipped"}
          reason={typeof output.reason === "string" ? output.reason : undefined}
          projectId={projectId}
        />
      ) : (
        /* Default — pre-formatted text */
        <TextOutput text={text} />
      )}

      {/* Asset management grid — shows upload/replace slots for asset-producing steps */}
      {output && getSlotsForStep(step).length > 0 && (
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
