"use client";

import { useMemo } from "react";
import { AssetSlot } from "./AssetSlot";
import { getSlotsForStep } from "@/lib/asset-validation";
import { parseSlotKey, getNestedValue } from "@/lib/asset-patch";
import type { PipelineStep } from "@/types";

interface AssetGridProps {
  projectId: string;
  step: PipelineStep;
  output: Record<string, unknown>;
  onOutputChanged: () => void;
}

/**
 * Resolve a URL from step output for a given slot key.
 * Tries the parsed path first, then known output patterns as fallback.
 */
function resolveSlotUrl(output: Record<string, unknown>, step: string, slotKey: string): string | null {
  // Primary: use the slot key path
  const path = parseSlotKey(slotKey);
  const primary = getNestedValue(output, path);
  if (typeof primary === "string" && primary.startsWith("http")) return primary;

  // Fallback: handle known output structures that don't match slot keys
  const indexMatch = slotKey.match(/\[(\d+)\]/);
  const idx = indexMatch ? parseInt(indexMatch[1]) : -1;

  if (step === "hero_scenes" && slotKey.includes("video_url") && Array.isArray(output.scenes)) {
    const scene = (output.scenes as Record<string, unknown>[])[idx];
    if (scene?.video_url && typeof scene.video_url === "string") return scene.video_url;
  }

  if (step === "stock_footage" && slotKey.includes("stock_clips") && Array.isArray(output.footage)) {
    // Flatten footage[].videos[] into a flat clip list
    const clips: string[] = [];
    for (const group of output.footage as Record<string, unknown>[]) {
      if (Array.isArray(group?.videos)) {
        for (const v of group.videos as Record<string, unknown>[]) {
          if (typeof v?.url === "string") clips.push(v.url);
        }
      }
    }
    if (idx >= 0 && idx < clips.length) return clips[idx];
  }

  if (step === "voiceover_generation" && slotKey === "audio_url") {
    if (typeof output.audio_url === "string" && output.audio_url.startsWith("http")) return output.audio_url;
  }

  return null;
}

/**
 * Renders a grid of AssetSlots for a pipeline step.
 * Reads slot definitions to determine how many slots exist,
 * then maps the current step output to populate them.
 */
export function AssetGrid({ projectId, step, output, onOutputChanged }: AssetGridProps) {
  const slotDefs = useMemo(() => getSlotsForStep(step), [step]);

  if (slotDefs.length === 0) return null;

  // Determine columns based on slot count
  const cols = slotDefs.length === 1 ? "grid-cols-1"
    : slotDefs.length === 2 ? "grid-cols-1 sm:grid-cols-2"
    : "grid-cols-1 sm:grid-cols-2 md:grid-cols-3";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Asset Slots
        </span>
        <span className="text-xs text-muted-foreground">
          {slotDefs.filter((s) => resolveSlotUrl(output, step, s.slotKey) != null).length} / {slotDefs.length} filled
        </span>
      </div>
      <div className={`grid ${cols} gap-3`}>
        {slotDefs.map((slotDef) => {
          const currentUrl = resolveSlotUrl(output, step, slotDef.slotKey);

          return (
            <AssetSlot
              key={slotDef.slotKey}
              projectId={projectId}
              slotDef={slotDef}
              currentUrl={currentUrl}
              onAssetChanged={onOutputChanged}
            />
          );
        })}
      </div>
    </div>
  );
}
