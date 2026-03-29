"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight } from "lucide-react";

interface StockFootageGridProps {
  output: Record<string, unknown>;
  projectId: string;
  onOutputChanged: () => void;
}

type VideoClip = { url: string; file_url?: string; thumbnail?: string; duration: number };
type FootageGroup = { query: string; label?: string; scene_id?: number | null; videos: VideoClip[] };

export function StockFootageGrid({ output }: StockFootageGridProps) {
  const footage = (output.footage as FootageGroup[]) || [];
  const [showAll, setShowAll] = useState(false);

  // Slot count is the number of STOCK scenes (groups), not hardcoded
  const productionSlots = useMemo(() => footage.map((group, i) => ({
    slotNum: i + 1,
    label: group.label || `Stock Scene ${i + 1}`,
    scene_id: group.scene_id ?? null,
    query: group.query,
    // First clip in each group is what goes to production (assembler takes them in order)
    clip: group.videos?.[0] ?? null,
    extras: group.videos?.slice(1) ?? [],
  })), [footage]);

  const totalExtras = useMemo(() => productionSlots.reduce((n, s) => n + s.extras.length, 0), [productionSlots]);

  return (
    <div className="space-y-3">
      {/* Production slots — one per STOCK scene */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
        {productionSlots.map((slot) => {
          const clip = slot.clip;
          const thumbUrl = clip?.thumbnail || clip?.file_url || clip?.url;

          return (
            <div key={slot.slotNum} className="rounded-lg overflow-hidden border border-primary/30 bg-muted/20">
              {clip ? (
                <a href={clip.file_url || clip.url} target="_blank" rel="noopener noreferrer" className="block relative group">
                  {thumbUrl ? (
                    <img src={thumbUrl} alt={slot.label} className="w-full aspect-video object-cover" />
                  ) : (
                    <div className="w-full aspect-video bg-muted flex items-center justify-center">
                      <span className="text-xs text-muted-foreground">No preview</span>
                    </div>
                  )}
                  {/* "Goes to production" badge */}
                  <span className="absolute top-1 left-1 text-[9px] bg-primary text-primary-foreground px-1.5 py-0.5 rounded font-semibold opacity-90">
                    PRODUCTION
                  </span>
                </a>
              ) : (
                <div className="w-full aspect-video bg-muted flex items-center justify-center">
                  <span className="text-xs text-muted-foreground">No clip</span>
                </div>
              )}
              <div className="px-2 py-1 border-t border-muted-foreground/10 space-y-0.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground">{clip ? `${clip.duration}s` : "Empty"}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {slot.scene_id ? `Scene ${slot.scene_id}` : `Slot ${slot.slotNum}`}
                  </Badge>
                </div>
                <p className="text-[9px] text-muted-foreground truncate" title={slot.label}>{slot.label}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Expandable: all alternative clips per scene */}
      {totalExtras > 0 && (
        <div>
          <button
            onClick={() => setShowAll(!showAll)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showAll ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {showAll ? "Hide" : "Browse"} {totalExtras} more clips from {footage.length} searches
          </button>

          {showAll && (
            <div className="mt-3 space-y-3 pl-2 border-l-2 border-muted-foreground/10">
              {productionSlots.map((slot) => (
                <div key={slot.slotNum}>
                  <p className="text-[10px] font-medium text-muted-foreground mb-1">
                    {slot.scene_id ? `Scene ${slot.scene_id} — ` : ""}&ldquo;{slot.query}&rdquo;
                  </p>
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-1.5">
                    {/* Show production clip (dimmed) + extras */}
                    {slot.clip && (
                      <a
                        href={slot.clip.file_url || slot.clip.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block rounded overflow-hidden border border-primary/40 opacity-50"
                        title="In production"
                      >
                        {slot.clip.thumbnail
                          ? <img src={slot.clip.thumbnail} alt="" className="w-full aspect-video object-cover" />
                          : <div className="w-full aspect-video bg-muted" />
                        }
                        <div className="px-1 py-0.5 text-[9px] text-primary flex justify-between">
                          <span>{slot.clip.duration}s</span>
                          <span>✓ used</span>
                        </div>
                      </a>
                    )}
                    {slot.extras.map((v, vi) => (
                      <a
                        key={vi}
                        href={v.file_url || v.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block rounded overflow-hidden border border-muted hover:border-muted-foreground/30 transition-colors"
                      >
                        {v.thumbnail
                          ? <img src={v.thumbnail} alt="" className="w-full aspect-video object-cover" />
                          : <div className="w-full aspect-video bg-muted" />
                        }
                        <div className="px-1 py-0.5 text-[9px] text-muted-foreground">
                          <span>{v.duration}s</span>
                        </div>
                      </a>
                    ))}
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
