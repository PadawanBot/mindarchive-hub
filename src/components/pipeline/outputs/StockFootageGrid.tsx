"use client";

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { AssetSlot } from "@/components/assets/AssetSlot";
import { getSlotsForStep } from "@/lib/asset-validation";
import type { PipelineStep } from "@/types";

interface StockFootageGridProps {
  output: Record<string, unknown>;
  projectId: string;
  onOutputChanged: () => void;
}

type VideoClip = { url: string; file_url?: string; thumbnail?: string; duration: number };
type FootageGroup = { query: string; videos: VideoClip[] };

/**
 * Flatten footage[].videos[] into an ordered clip list matching asset slot indices.
 */
function flattenClips(footage: FootageGroup[]): { clip: VideoClip; groupIdx: number; videoIdx: number }[] {
  const flat: { clip: VideoClip; groupIdx: number; videoIdx: number }[] = [];
  footage.forEach((group, gi) => {
    group.videos.forEach((v, vi) => {
      flat.push({ clip: v, groupIdx: gi, videoIdx: vi });
    });
  });
  return flat;
}

export function StockFootageGrid({ output, projectId, onOutputChanged }: StockFootageGridProps) {
  const footage = output.footage as FootageGroup[];
  const flatClips = useMemo(() => flattenClips(footage), [footage]);
  const slotDefs = useMemo(() => getSlotsForStep("stock_footage"), []);

  // Map slot index to the clip that fills it (first 5 clips from the flattened list)
  const slotClipMap = useMemo(() => {
    const map: Record<number, { clip: VideoClip; groupIdx: number; videoIdx: number } | null> = {};
    slotDefs.forEach((_, i) => {
      map[i] = i < flatClips.length ? flatClips[i] : null;
    });
    return map;
  }, [flatClips, slotDefs]);

  return (
    <div className="space-y-4">
      {/* Search results with slot indicators */}
      {footage.map((group, gi) => (
        <div key={gi}>
          <p className="text-xs font-medium text-muted-foreground mb-2">
            Search: &ldquo;{group.query}&rdquo;
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {group.videos.map((v, vi) => {
              // Find which slot this clip occupies (if any)
              const slotIdx = flatClips.findIndex(
                (fc) => fc.groupIdx === gi && fc.videoIdx === vi
              );
              const isAssigned = slotIdx >= 0 && slotIdx < slotDefs.length;

              return (
                <a
                  key={vi}
                  href={v.file_url || v.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`block rounded-lg overflow-hidden border transition-colors ${
                    isAssigned
                      ? "border-primary/40 ring-1 ring-primary/20"
                      : "border-muted hover:border-muted-foreground/30"
                  }`}
                >
                  {v.thumbnail ? (
                    <img
                      src={v.thumbnail}
                      alt={`Stock clip ${vi + 1}`}
                      className="w-full aspect-video object-cover"
                    />
                  ) : (
                    <div className="w-full aspect-video bg-muted flex items-center justify-center">
                      <span className="text-xs text-muted-foreground">No preview</span>
                    </div>
                  )}
                  <div className="px-2 py-1.5 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      Video {vi + 1} ({v.duration}s)
                    </span>
                    {isAssigned && (
                      <Badge variant="outline" className="text-[10px] border-primary/30 text-primary">
                        Slot {slotIdx + 1}
                      </Badge>
                    )}
                  </div>
                </a>
              );
            })}
          </div>
        </div>
      ))}

      {/* Manual upload slots — only show empty/unassigned slots */}
      {slotDefs.some((_, i) => !slotClipMap[i]) && (
        <div className="pt-3 border-t border-muted-foreground/10">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Empty Slots — Upload Manually
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {slotDefs.map((slotDef, i) => {
              // Only show slots that aren't filled by pipeline clips
              if (slotClipMap[i]) return null;
              return (
                <AssetSlot
                  key={slotDef.slotKey}
                  projectId={projectId}
                  slotDef={slotDef}
                  currentUrl={null}
                  onAssetChanged={onOutputChanged}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Summary */}
      <div className="text-xs text-muted-foreground">
        {Math.min(flatClips.length, slotDefs.length)} / {slotDefs.length} slots filled from pipeline
        {flatClips.length > slotDefs.length && ` · ${flatClips.length - slotDefs.length} extra clips available`}
      </div>
    </div>
  );
}
