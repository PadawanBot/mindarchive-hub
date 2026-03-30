"use client";

import { useState, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Copy, Check, Upload, RefreshCw, ChevronDown, ChevronRight, ExternalLink, AlertTriangle } from "lucide-react";
import type { SceneVideo } from "@/types";

interface SceneVideoPanelProps {
  scenes: SceneVideo[];
  projectId: string;
  onScenesChanged?: () => void;
}

const STATUS_STYLES: Record<string, { variant: "default" | "outline" | "warning" | "destructive"; label: string }> = {
  completed: { variant: "default", label: "Ready" },
  submitted: { variant: "warning", label: "Generating..." },
  pending: { variant: "outline", label: "Pending" },
  failed: { variant: "destructive", label: "Failed" },
  rejected: { variant: "destructive", label: "Rejected" },
};

export function SceneVideoPanel({ scenes: initialScenes, projectId, onScenesChanged }: SceneVideoPanelProps) {
  const [scenes, setScenes] = useState<SceneVideo[]>(initialScenes);
  const [editedPrompts, setEditedPrompts] = useState<Record<number, string>>({});
  const [generating, setGenerating] = useState<Record<number, boolean>>({});
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [copied, setCopied] = useState<Record<number, boolean>>({});
  const fileInputRefs = useRef<Record<number, HTMLInputElement | null>>({});

  const completedCount = scenes.filter(s => s.status === "completed").length;

  const handleCopy = (sceneId: number, prompt: string) => {
    navigator.clipboard.writeText(prompt);
    setCopied(prev => ({ ...prev, [sceneId]: true }));
    setTimeout(() => setCopied(prev => ({ ...prev, [sceneId]: false })), 2000);
  };

  const handleGenerate = async (scene: SceneVideo) => {
    const prompt = editedPrompts[scene.scene_id] || scene.prompt;
    setGenerating(prev => ({ ...prev, [scene.scene_id]: true }));
    // Mark as submitted while generating
    setScenes(prev => prev.map(s =>
      s.scene_id === scene.scene_id ? { ...s, status: "submitted" as const, error: undefined } : s
    ));

    try {
      const res = await fetch("/api/pipeline/step/regenerate-hero-scene", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, scene_id: scene.scene_id, prompt }),
      });
      const data = await res.json();

      if (data.success && data.scene) {
        setScenes(prev => prev.map(s => s.scene_id === scene.scene_id ? data.scene : s));
        setEditedPrompts(prev => { const next = { ...prev }; delete next[scene.scene_id]; return next; });
        onScenesChanged?.();
      } else {
        setScenes(prev => prev.map(s =>
          s.scene_id === scene.scene_id
            ? { ...s, status: data.rejected ? "rejected" as const : "failed" as const, error: data.error }
            : s
        ));
      }
    } catch (err) {
      setScenes(prev => prev.map(s =>
        s.scene_id === scene.scene_id ? { ...s, status: "failed" as const, error: String(err) } : s
      ));
    }

    setGenerating(prev => ({ ...prev, [scene.scene_id]: false }));
  };

  const handleUpload = async (scene: SceneVideo, file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("project_id", projectId);
    formData.append("step", "hero_scenes");
    formData.append("asset_type", "runway_video");
    formData.append("slot_name", `scenes[${scenes.indexOf(scene)}].video_url`);

    try {
      const uploadRes = await fetch("/api/assets/manual-upload", { method: "POST", body: formData });
      const uploadData = await uploadRes.json();

      if (!uploadData.success || !uploadData.data?.url) {
        console.error("Upload failed:", uploadData.error || "No URL returned");
        setScenes(prev => prev.map(s =>
          s.scene_id === scene.scene_id ? { ...s, error: `Upload failed: ${uploadData.error || "unknown error"}` } : s
        ));
        return;
      }

      setScenes(prev => prev.map(s =>
        s.scene_id === scene.scene_id
          ? { ...s, video_url: uploadData.data.url, status: "completed" as const, error: undefined }
          : s
      ));
      onScenesChanged?.();
    } catch (err) {
      console.error("Upload failed:", err);
      setScenes(prev => prev.map(s =>
        s.scene_id === scene.scene_id ? { ...s, error: `Upload error: ${String(err)}` } : s
      ));
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {completedCount} of {scenes.length} Runway hero scenes ready
      </p>

      <div className="space-y-2">
        {scenes.map((scene) => {
          const isExpanded = expanded[scene.scene_id] ?? false;
          const currentPrompt = editedPrompts[scene.scene_id] ?? scene.prompt;
          const isModified = editedPrompts[scene.scene_id] !== undefined && editedPrompts[scene.scene_id] !== scene.prompt;
          const style = STATUS_STYLES[scene.status] || STATUS_STYLES.pending;
          const isGenerating = generating[scene.scene_id];

          return (
            <div key={scene.scene_id} className="border border-muted-foreground/10 rounded-lg overflow-hidden">
              {/* Header row */}
              <div className="flex items-center gap-2 px-3 py-2">
                <button
                  onClick={() => setExpanded(prev => ({ ...prev, [scene.scene_id]: !isExpanded }))}
                  className="shrink-0"
                >
                  {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                </button>
                <Badge variant="outline" className="text-[10px] shrink-0">#{scene.scene_id}</Badge>
                <span className="text-sm font-medium flex-1 truncate">{scene.label || `Scene ${scene.scene_id}`}</span>
                {scene.status === "submitted" && (
                  <RefreshCw className="h-3 w-3 animate-spin text-yellow-500 shrink-0" />
                )}
                <Badge variant={style.variant} className="text-[10px] shrink-0">{style.label}</Badge>
              </div>

              {/* Video preview (always visible if completed) */}
              {scene.status === "completed" && scene.video_url && (
                <div className="px-3 pb-2">
                  <video
                    src={scene.video_url}
                    controls
                    className="w-full max-h-48 rounded"
                    onError={(e) => { (e.target as HTMLVideoElement).style.display = "none"; }}
                  />
                </div>
              )}

              {/* Error message for rejected/failed */}
              {(scene.status === "rejected" || scene.status === "failed") && scene.error && (
                <div className="px-3 pb-2">
                  <div className="flex items-start gap-2 text-xs text-red-400 bg-red-500/10 rounded p-2">
                    <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                    <span className="line-clamp-2">{scene.error}</span>
                  </div>
                </div>
              )}

              {/* Expanded: prompt + actions */}
              {isExpanded && (
                <div className="px-3 pb-3 space-y-2">
                  <textarea
                    value={currentPrompt}
                    onChange={(e) => setEditedPrompts(prev => ({ ...prev, [scene.scene_id]: e.target.value }))}
                    className="w-full text-xs bg-muted/30 border border-muted-foreground/10 rounded p-2 resize-y min-h-[60px] max-h-[200px] font-mono"
                    rows={3}
                  />
                  {scene.motion_type && (
                    <p className="text-[10px] text-muted-foreground">Motion: {scene.motion_type}</p>
                  )}
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleCopy(scene.scene_id, currentPrompt)}
                      className="text-xs h-7"
                    >
                      {copied[scene.scene_id] ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
                      {copied[scene.scene_id] ? "Copied" : "Copy"}
                    </Button>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => fileInputRefs.current[scene.scene_id]?.click()}
                      className="text-xs h-7"
                    >
                      <Upload className="h-3 w-3 mr-1" />Upload
                    </Button>
                    <input
                      ref={(el) => { fileInputRefs.current[scene.scene_id] = el; }}
                      type="file"
                      accept="video/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleUpload(scene, file);
                        e.target.value = "";
                      }}
                    />

                    <Button
                      variant={isModified ? "primary" : "secondary"}
                      size="sm"
                      onClick={() => handleGenerate(scene)}
                      disabled={isGenerating || scene.status === "submitted"}
                      className="text-xs h-7 ml-auto"
                    >
                      <RefreshCw className={`h-3 w-3 mr-1 ${isGenerating ? "animate-spin" : ""}`} />
                      {isGenerating ? "Generating (~2min)..." : isModified ? "Generate (edited)" : "Generate"}
                    </Button>

                    {scene.video_url && (
                      <a href={scene.video_url} target="_blank" rel="noopener noreferrer">
                        <Button variant="ghost" size="sm" className="text-xs h-7">
                          <ExternalLink className="h-3 w-3" />
                        </Button>
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
