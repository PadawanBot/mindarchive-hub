"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AssetSlot } from "@/components/assets/AssetSlot";
import { getSlotsForStep } from "@/lib/asset-validation";
import { ChevronDown, ChevronRight } from "lucide-react";
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
  const [showAll, setShowAll] = useState(false);

  // The 5 slotted clips (first 5 from flattened list)
  const slottedClips = useMemo(() => flatClips.slice(0, slotDefs.length), [flatClips, slotDefs]);
  const extraCount = flatClips.length - slottedClips.length;

  return (
    <div className="space-y-3">
      {/* Primary: 5 slotted clips */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
        {slotDefs.map((slotDef, i) => {
          const entry = slottedClips[i];
          const clip = entry?.clip;
          const thumbUrl = clip?.thumbnail || clip?.file_url || clip?.url;

          return (
            <div key={slotDef.slotKey} className="rounded-lg overflow-hidden border border-muted bg-muted/20">
              {clip ? (
                <a href={clip.file_url || clip.url} target="_blank" rel="noopener noreferrer" className="block">
                  {thumbUrl ? (
                    <img src={thumbUrl} alt={slotDef.label} className="w-full aspect-video object-cover" />
                  ) : (
                    <div className="w-full aspect-video bg-muted flex items-center justify-center">
                      <span className="text-xs text-muted-foreground">No preview</span>
                    </div>
                  )}
                </a>
              ) : (
                <AssetSlot
                  projectId={projectId}
                  slotDef={slotDef}
                  currentUrl={null}
                  onAssetChanged={onOutputChanged}
                />
              )}
              <div className="px-2 py-1 flex items-center justify-between border-t border-muted-foreground/10">
                <span className="text-[10px] text-muted-foreground truncate">
                  {clip ? `${clip.duration}s` : "Empty"}
                </span>
                <Badge variant="outline" className="text-[10px]">
                  Slot {i + 1}
                </Badge>
              </div>
            </div>
          );
        })}
      </div>

      {/* Expandable: all search results */}
      {extraCount > 0 && (
        <div>
          <button
            onClick={() => setShowAll(!showAll)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showAll ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {showAll ? "Hide" : "Browse"} {extraCount} more clips from {footage.length} searches
          </button>

          {showAll && (
            <div className="mt-3 space-y-3 pl-2 border-l-2 border-muted-foreground/10">
              {footage.map((group, gi) => (
                <div key={gi}>
                  <p className="text-[10px] font-medium text-muted-foreground mb-1">
                    &ldquo;{group.query}&rdquo;
                  </p>
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-1.5">
                    {group.videos.map((v, vi) => {
                      const globalIdx = flatClips.findIndex(fc => fc.groupIdx === gi && fc.videoIdx === vi);
                      const isSlotted = globalIdx >= 0 && globalIdx < slotDefs.length;

                      return (
                        <a
                          key={vi}
                          href={v.file_url || v.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`block rounded overflow-hidden border transition-colors ${
                            isSlotted ? "border-primary/40 opacity-60" : "border-muted hover:border-muted-foreground/30"
                          }`}
                        >
                          {v.thumbnail ? (
                            <img src={v.thumbnail} alt="" className="w-full aspect-video object-cover" />
                          ) : (
                            <div className="w-full aspect-video bg-muted" />
                          )}
                          <div className="px-1 py-0.5 text-[9px] text-muted-foreground flex justify-between">
                            <span>{v.duration}s</span>
                            {isSlotted && <span className="text-primary">S{globalIdx + 1}</span>}
                          </div>
                        </a>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
