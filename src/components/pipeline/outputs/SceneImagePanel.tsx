"use client";

import { useState, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Copy, Check, Upload, RefreshCw, ChevronDown, ChevronRight, ExternalLink, AlertTriangle } from "lucide-react";
import type { SceneImage } from "@/types";

interface SceneImagePanelProps {
  scenes: SceneImage[];
  projectId: string;
  onScenesChanged?: () => void;
}

const STATUS_STYLES: Record<string, { variant: "default" | "outline" | "warning" | "destructive"; label: string }> = {
  completed: { variant: "default", label: "Generated" },
  pending: { variant: "outline", label: "Pending" },
  failed: { variant: "destructive", label: "Failed" },
  rejected: { variant: "destructive", label: "Rejected" },
};

export function SceneImagePanel({ scenes: initialScenes, projectId, onScenesChanged }: SceneImagePanelProps) {
  const [scenes, setScenes] = useState<SceneImage[]>(initialScenes);
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

  const handleGenerate = async (scene: SceneImage) => {
    const prompt = editedPrompts[scene.scene_id] || scene.prompt;
    setGenerating(prev => ({ ...prev, [scene.scene_id]: true }));

    try {
      const res = await fetch("/api/pipeline/step/regenerate-scene", {
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
        // Show rejection/failure inline
        setScenes(prev => prev.map(s =>
          s.scene_id === scene.scene_id
            ? { ...s, status: data.rejected ? "rejected" : "failed", error: data.error }
            : s
        ));
      }
    } catch (err) {
      setScenes(prev => prev.map(s =>
        s.scene_id === scene.scene_id ? { ...s, status: "failed", error: String(err) } : s
      ));
    }

    setGenerating(prev => ({ ...prev, [scene.scene_id]: false }));
  };

  const handleUpload = async (scene: SceneImage, file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("project_id", projectId);
    formData.append("step", "image_generation");
    formData.append("asset_type", "dalle_image");
    formData.append("slot_name", `scenes[${scenes.indexOf(scene)}].image_url`);

    try {
      const uploadRes = await fetch("/api/assets/manual-upload", { method: "POST", body: formData });
      const uploadData = await uploadRes.json();
      if (!uploadData.success || !uploadData.data?.url) return;

      // Update step output with the uploaded image URL
      const updatedScenes = scenes.map(s =>
        s.scene_id === scene.scene_id
          ? { ...s, image_url: uploadData.data.url, status: "completed" as const, error: undefined }
          : s
      );

      await fetch("/api/pipeline/step/update-output", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          step: "image_generation",
          output_update: {
            scenes: updatedScenes,
            images: updatedScenes.filter(s => s.status === "completed" && s.image_url).map(s => ({
              url: s.image_url!, prompt: s.prompt, revised_prompt: s.revised_prompt || "", stored: true,
            })),
          },
        }),
      });

      setScenes(updatedScenes);
      onScenesChanged?.();
    } catch (err) {
      console.error("Upload failed:", err);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {completedCount} of {scenes.length} DALL-E scenes generated
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
                <Badge variant={style.variant} className="text-[10px] shrink-0">{style.label}</Badge>
              </div>

              {/* Image preview (always visible if completed) */}
              {scene.status === "completed" && scene.image_url && (
                <div className="px-3 pb-2">
                  <a href={scene.image_url} target="_blank" rel="noopener noreferrer" className="block">
                    <img
                      src={scene.image_url}
                      alt={`Scene ${scene.scene_id}`}
                      className="w-full max-h-48 object-cover rounded hover:opacity-80 transition-opacity"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  </a>
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
                      accept="image/*"
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
                      disabled={isGenerating}
                      className="text-xs h-7 ml-auto"
                    >
                      <RefreshCw className={`h-3 w-3 mr-1 ${isGenerating ? "animate-spin" : ""}`} />
                      {isGenerating ? "Generating..." : isModified ? "Generate (edited)" : "Generate"}
                    </Button>

                    {scene.image_url && (
                      <a href={scene.image_url} target="_blank" rel="noopener noreferrer">
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
