"use client";

import { useState, useMemo } from "react";

const SEPARATOR = "=== VISUAL DIRECTION JSON ===";

interface SceneEntry {
  scene_id: number;
  label: string;
  act: string;
  tag: string;
  narration_summary: string;
  transition_in: string;
  transition_out: string;
  dalle_prompt?: string;
  ken_burns?: string;
  runway_prompt?: string;
  motion_type?: string;
  stock_keywords?: string;
  pexels_keywords?: string[];
  motion_graphic_spec?: string;
}

const TAG_COLOURS: Record<string, string> = {
  DALLE: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  RUNWAY: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  STOCK: "bg-green-500/20 text-green-300 border-green-500/30",
  MOTION_GRAPHIC: "bg-orange-500/20 text-orange-300 border-orange-500/30",
};

function SceneCard({ scene }: { scene: SceneEntry }) {
  const [open, setOpen] = useState(false);
  const tagClass = TAG_COLOURS[scene.tag] || "bg-muted text-muted-foreground border-muted";

  return (
    <div className="border border-muted-foreground/15 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
      >
        <span className="text-xs text-muted-foreground w-6 shrink-0">#{scene.scene_id}</span>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded border shrink-0 ${tagClass}`}>{scene.tag}</span>
        <span className="text-xs font-medium truncate">{scene.label}</span>
        <span className="text-xs text-muted-foreground ml-auto shrink-0">ACT {scene.act}</span>
        <span className="text-muted-foreground text-xs ml-2">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-2 border-t border-muted-foreground/10 pt-3">
          <p className="text-xs text-muted-foreground italic">{scene.narration_summary}</p>

          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <div><span className="text-muted-foreground">In: </span>{scene.transition_in}</div>
            <div><span className="text-muted-foreground">Out: </span>{scene.transition_out}</div>
          </div>

          {scene.dalle_prompt && (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-blue-300">DALL-E Prompt</p>
              <p className="text-xs bg-muted/60 p-2 rounded">{scene.dalle_prompt}</p>
              {scene.ken_burns && <p className="text-xs text-muted-foreground"><span className="font-semibold">Ken Burns: </span>{scene.ken_burns}</p>}
            </div>
          )}

          {scene.runway_prompt && (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-purple-300">Runway Prompt</p>
              <p className="text-xs bg-muted/60 p-2 rounded">{scene.runway_prompt}</p>
              {scene.motion_type && <p className="text-xs text-muted-foreground"><span className="font-semibold">Motion: </span>{scene.motion_type}</p>}
            </div>
          )}

          {scene.stock_keywords && (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-green-300">Stock Keywords</p>
              <p className="text-xs bg-muted/60 p-2 rounded">{scene.stock_keywords}</p>
              {scene.pexels_keywords && scene.pexels_keywords.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {scene.pexels_keywords.map((kw, i) => (
                    <span key={i} className="text-xs bg-green-500/10 border border-green-500/20 text-green-300 px-2 py-0.5 rounded">{kw}</span>
                  ))}
                </div>
              )}
            </div>
          )}

          {scene.motion_graphic_spec && (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-orange-300">Motion Graphic Spec</p>
              <p className="text-xs bg-muted/60 p-2 rounded">{scene.motion_graphic_spec}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function VisualDirectionOutput({ text }: { text: string }) {
  const [tab, setTab] = useState<"doc" | "json">("doc");

  const { doc, scenes, jsonError } = useMemo(() => {
    const idx = text.indexOf(SEPARATOR);
    if (idx === -1) return { doc: text, scenes: [], jsonError: null };

    const doc = text.slice(0, idx).trim();
    const jsonRaw = text.slice(idx + SEPARATOR.length).trim();
    try {
      const scenes: SceneEntry[] = JSON.parse(jsonRaw);
      return { doc, scenes, jsonError: null };
    } catch (e) {
      return { doc, scenes: [], jsonError: jsonRaw };
    }
  }, [text]);

  const hasJson = scenes.length > 0 || jsonError !== null;

  return (
    <div>
      {/* Tab bar */}
      <div className="flex gap-1 mb-3">
        <button
          onClick={() => setTab("doc")}
          className={`text-xs px-3 py-1.5 rounded font-medium transition-colors ${tab === "doc" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"}`}
        >
          Direction Doc
        </button>
        <button
          onClick={() => setTab("json")}
          disabled={!hasJson}
          className={`text-xs px-3 py-1.5 rounded font-medium transition-colors ${tab === "json" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"} disabled:opacity-40`}
        >
          Scene JSON {scenes.length > 0 && <span className="ml-1 opacity-70">({scenes.length})</span>}
        </button>
      </div>

      {/* Tab content */}
      {tab === "doc" ? (
        <pre className="whitespace-pre-wrap text-sm bg-muted p-4 rounded-lg max-h-96 overflow-y-auto">
          {doc}
        </pre>
      ) : jsonError !== null ? (
        <div className="space-y-2">
          <p className="text-xs text-destructive">JSON parse error — raw output below:</p>
          <pre className="whitespace-pre-wrap text-xs bg-muted p-4 rounded-lg max-h-96 overflow-y-auto">{jsonError}</pre>
        </div>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
          {scenes.map((scene) => (
            <SceneCard key={scene.scene_id} scene={scene} />
          ))}
        </div>
      )}
    </div>
  );
}
