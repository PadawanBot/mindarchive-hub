"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  ArrowLeft,
  Image as ImageIcon,
  FileAudio,
  FileVideo,
  FolderOpen,
  RefreshCw,
  ExternalLink,
  Trash2,
  Upload,
  Plus,
  X,
  Copy,
  Check,
  Clapperboard,
} from "lucide-react";

interface AssetRow {
  id: string;
  type: string;
  filename: string;
  url: string | null;
  step: string | null;
  slot_key: string | null;
  source: string;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  created_at: string;
}

const STEP_LABELS: Record<string, string> = {
  voiceover_generation: "Voiceover",
  image_generation: "Images",
  stock_footage: "Stock Footage",
  motion_graphics: "Motion Graphics",
  thumbnail_creation: "Thumbnail",
  hero_scenes: "Hero Scenes",
  manual: "Manual Uploads",
};

/** Maps step names to asset_type values for the upload API */
const STEP_TO_ASSET_TYPE: Record<string, string> = {
  image_generation: "dalle_image",
  hero_scenes: "runway_video",
  stock_footage: "stock_video",
  voiceover_generation: "voiceover",
  motion_graphics: "motion_graphic",
  manual: "other",
};

const ASSET_TYPE_OPTIONS = [
  { value: "dalle_image", label: "DALL-E Image" },
  { value: "runway_video", label: "Runway Hero Scene" },
  { value: "stock_video", label: "Stock Video" },
  { value: "voiceover", label: "Voiceover" },
  { value: "motion_graphic", label: "Motion Graphic" },
  { value: "other", label: "Other" },
];

const ACCEPT_MAP: Record<string, string> = {
  dalle_image: "image/*",
  runway_video: "video/*",
  stock_video: "video/*",
  voiceover: "audio/*",
  motion_graphic: "image/*",
  other: "image/*,video/*,audio/*",
};

function formatSize(bytes: number): string {
  if (bytes === 0) return "\u2014";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// ─── Upload Modal ────────────────────────────────────────────────────────────

interface UploadModalProps {
  projectId: string;
  defaultAssetType?: string;
  onClose: () => void;
  onSuccess: () => void;
}

function UploadModal({ projectId, defaultAssetType, onClose, onSuccess }: UploadModalProps) {
  const [assetType, setAssetType] = useState(defaultAssetType || "dalle_image");
  const [slotName, setSlotName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] || null;
    setFile(selected);
    setError("");
  };

  const handleUpload = async () => {
    if (!file) {
      setError("Please select a file");
      return;
    }

    setUploading(true);
    setProgress(10);
    setError("");

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("project_id", projectId);
      formData.append("asset_type", assetType);
      if (slotName.trim()) {
        formData.append("slot_name", slotName.trim());
      }

      setProgress(30);

      const res = await fetch("/api/assets/manual-upload", {
        method: "POST",
        body: formData,
      });

      setProgress(80);

      const data = await res.json();
      if (!data.success) {
        setError(data.error || "Upload failed");
        setUploading(false);
        setProgress(0);
        return;
      }

      setProgress(100);
      const wasPooled = data.data?.pooled === true;

      // Brief delay to show 100% before closing
      setTimeout(() => {
        setUploading(false);
        if (wasPooled) {
          setError(""); // clear any prior error
          alert("Asset pooled! It will be assigned to a scene slot after Visual Direction completes.");
        }
        onSuccess();
        onClose();
      }, 400);
    } catch (err) {
      setError(String(err));
      setUploading(false);
      setProgress(0);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-card border border-border rounded-xl shadow-2xl w-full max-w-md mx-4 p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Upload Asset</h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Asset Type */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-muted-foreground">Asset Type</label>
          <Select
            value={assetType}
            onChange={(e) => {
              setAssetType(e.target.value);
              setFile(null);
              if (fileInputRef.current) fileInputRef.current.value = "";
            }}
          >
            {ASSET_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        </div>

        {/* Slot Name (optional) */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-muted-foreground">
            Slot Name <span className="text-xs text-muted-foreground/60">(optional)</span>
          </label>
          <Input
            placeholder="e.g. runway-scene-3, dalle-scene-5"
            value={slotName}
            onChange={(e) => setSlotName(e.target.value)}
          />
          <p className="text-xs text-muted-foreground/60">
            Specify a slot name to replace a specific asset (e.g. &quot;scenes[2].video_url&quot;)
          </p>
        </div>

        {/* File Picker */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-muted-foreground">File</label>
          <div
            className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
            onClick={() => fileInputRef.current?.click()}
          >
            {file ? (
              <div className="space-y-1">
                <p className="text-sm font-medium truncate">{file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatSize(file.size)} &middot; {file.type || "unknown type"}
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                <Upload className="w-8 h-8 mx-auto text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">Click to select a file</p>
                <p className="text-xs text-muted-foreground/60">Max 50MB</p>
              </div>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT_MAP[assetType] || "*/*"}
            onChange={handleFileChange}
            className="hidden"
          />
        </div>

        {/* Progress bar */}
        {uploading && (
          <div className="space-y-1">
            <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground text-center">
              Uploading... {progress}%
            </p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 justify-end pt-1">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={uploading}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleUpload} disabled={uploading || !file}>
            <Upload className="w-4 h-4 mr-1.5" />
            {uploading ? "Uploading..." : "Upload"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Inline Upload Button ────────────────────────────────────────────────────

interface InlineUploadProps {
  projectId: string;
  step: string;
  onSuccess: () => void;
}

function InlineUploadButton({ projectId, step, onSuccess }: InlineUploadProps) {
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const assetType = STEP_TO_ASSET_TYPE[step] || "other";
  const accept = ACCEPT_MAP[assetType] || "*/*";

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("project_id", projectId);
      formData.append("asset_type", assetType);

      const res = await fetch("/api/assets/manual-upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (data.success) {
        onSuccess();
      }
    } catch {
      // silently fail inline uploads
    }
    setUploading(false);
    // Reset input so the same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <>
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-dashed border-muted-foreground/30 text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors disabled:opacity-50"
        title={`Upload ${STEP_LABELS[step] || step} asset`}
      >
        {uploading ? (
          <RefreshCw className="w-3 h-3 animate-spin" />
        ) : (
          <Plus className="w-3 h-3" />
        )}
        {uploading ? "Uploading..." : "Upload"}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        onChange={handleFile}
        className="hidden"
      />
    </>
  );
}

// ─── Hero Scenes Panel ───────────────────────────────────────────────────────

interface HeroScene {
  section: string;
  promptText?: string;
  taskId?: string;
  video_url?: string;
}

interface HeroScenesPanelProps {
  projectId: string;
  onAssetsChanged: () => void;
}

function HeroScenesPanel({ projectId, onAssetsChanged }: HeroScenesPanelProps) {
  const [scenes, setScenes] = useState<HeroScene[]>([]);
  const [uploading, setUploading] = useState<Record<number, boolean>>({});
  const [copied, setCopied] = useState<Record<number, boolean>>({});
  const fileRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    fetch(`/api/pipeline/steps?project_id=${projectId}`)
      .then(r => r.json())
      .then(d => {
        if (!d.success) return;
        const heroStep = (d.data as { step: string; output?: Record<string, unknown> }[])
          .find(s => s.step === "hero_scenes");
        const raw = heroStep?.output as { scenes?: HeroScene[] } | undefined;
        if (raw?.scenes?.length) setScenes(raw.scenes);
      })
      .catch(() => {});
  }, [projectId]);

  const copyPrompt = (index: number, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(prev => ({ ...prev, [index]: true }));
      setTimeout(() => setCopied(prev => ({ ...prev, [index]: false })), 2000);
    });
  };

  const handleUpload = async (index: number, file: File) => {
    setUploading(prev => ({ ...prev, [index]: true }));
    try {
      // 1. Upload to asset library
      const formData = new FormData();
      formData.append("file", file);
      formData.append("project_id", projectId);
      formData.append("asset_type", "runway_video");
      formData.append("slot_name", `scenes[${index}].video_url`);
      const uploadRes = await fetch("/api/assets/manual-upload", { method: "POST", body: formData });
      const uploadData = await uploadRes.json();
      if (!uploadData.success) throw new Error(uploadData.error || "Upload failed");

      const videoUrl: string = uploadData.data?.url || uploadData.data?.asset?.url;
      if (!videoUrl) throw new Error("No URL returned");

      // 2. Wire into hero_scenes step output
      const updatedScenes = scenes.map((s, i) =>
        i === index ? { ...s, video_url: videoUrl } : s
      );
      await fetch("/api/pipeline/step/update-output", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          step: "hero_scenes",
          output_update: { scenes: updatedScenes },
        }),
      });

      setScenes(updatedScenes);
      onAssetsChanged();
    } catch (err) {
      alert(`Upload failed: ${String(err)}`);
    }
    setUploading(prev => ({ ...prev, [index]: false }));
    if (fileRefs.current[index]) fileRefs.current[index]!.value = "";
  };

  if (scenes.length === 0) return null;

  return (
    <Card>
      <CardTitle className="flex items-center gap-2 text-base">
        <Clapperboard className="w-4 h-4 text-purple-400" />
        Hero Scene Slots
        <Badge variant="outline" className="text-xs">{scenes.length} scenes</Badge>
        <span className="text-xs text-muted-foreground font-normal ml-1">— upload externally generated clips (Grok, Sora, etc.)</span>
      </CardTitle>
      <CardContent className="mt-3 space-y-3">
        {scenes.map((scene, i) => (
          <div key={i} className="flex items-start gap-3 p-3 rounded-lg border border-muted-foreground/10 bg-muted/20">
            {/* Scene number */}
            <div className="shrink-0 w-7 h-7 rounded-full bg-purple-500/20 text-purple-300 flex items-center justify-center text-xs font-bold">
              {i + 1}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0 space-y-1">
              <p className="text-xs font-semibold">{scene.section}</p>
              {scene.promptText && (
                <div className="flex items-start gap-1.5">
                  <p className="text-xs text-muted-foreground leading-relaxed flex-1">{scene.promptText}</p>
                  <button
                    onClick={() => copyPrompt(i, scene.promptText!)}
                    className="shrink-0 p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                    title="Copy prompt for Grok / Sora"
                  >
                    {copied[i] ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              )}
            </div>

            {/* Status + upload */}
            <div className="shrink-0 flex flex-col items-end gap-1.5">
              {scene.video_url ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-green-500 font-medium">✓ Video ready</span>
                  <a href={scene.video_url} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-muted-foreground hover:text-foreground">
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              ) : scene.taskId && !scene.taskId.startsWith("error:") ? (
                <span className="text-xs text-yellow-500">Runway pending</span>
              ) : (
                <span className="text-xs text-muted-foreground">No video</span>
              )}
              <button
                onClick={() => fileRefs.current[i]?.click()}
                disabled={uploading[i]}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded border border-dashed border-purple-500/40 text-purple-300 hover:bg-purple-500/10 transition-colors disabled:opacity-50"
              >
                {uploading[i] ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                {uploading[i] ? "Uploading..." : scene.video_url ? "Replace" : "Upload clip"}
              </button>
              <input
                ref={el => { fileRefs.current[i] = el; }}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(i, f); }}
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ─── Asset Reassignment Panel ───────────────────────────────────────────────

interface PoolScene {
  scene_id: number;
  label: string;
  prompt: string;
  image_url?: string | null;
  video_url?: string | null;
  status: string;
}

interface ReassignmentPanelProps {
  projectId: string;
  step: "image_generation" | "hero_scenes";
  onMappingApplied: () => void;
}

function AssetReassignmentPanel({ projectId, step, onMappingApplied }: ReassignmentPanelProps) {
  const [pooledAssets, setPooledAssets] = useState<AssetRow[]>([]);
  const [manualAssets, setManualAssets] = useState<AssetRow[]>([]);
  const [scenes, setScenes] = useState<PoolScene[]>([]);
  const [vdReady, setVdReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [mappings, setMappings] = useState<Record<string, number>>({});

  const isHero = step === "hero_scenes";
  const label = isHero ? "Hero Scenes" : "DALL-E Images";
  const urlField = isHero ? "video_url" : "image_url";

  useEffect(() => {
    setLoading(true);
    fetch(`/api/assets/pool-status?project_id=${projectId}&step=${step}`)
      .then(r => r.json())
      .then(d => {
        if (!d.success) return;
        setPooledAssets(d.data.pooled_assets || []);
        setManualAssets(d.data.manual_assets || []);
        setScenes(d.data.scenes || []);
        setVdReady(d.data.visual_direction_ready);

        // Initialize mappings: pooled assets get auto-assigned by position to pending scenes
        const pending = (d.data.scenes || []).filter(
          (s: PoolScene) => {
            const url = isHero ? s.video_url : s.image_url;
            return s.status !== "completed" || !url;
          },
        );
        const init: Record<string, number> = {};
        (d.data.pooled_assets || []).forEach((a: AssetRow, i: number) => {
          if (i < pending.length) init[a.id] = pending[i].scene_id;
        });
        setMappings(init);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId, step, urlField]);

  const applyMappings = async () => {
    const mappingList = Object.entries(mappings)
      .filter(([, sceneId]) => sceneId > 0)
      .map(([asset_id, scene_id]) => ({ asset_id, scene_id }));

    if (mappingList.length === 0) return;

    setApplying(true);
    try {
      const res = await fetch("/api/assets/reassign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, step, mappings: mappingList }),
      });
      const data = await res.json();
      if (data.success) {
        onMappingApplied();
        // Reload state
        setPooledAssets([]);
      }
    } catch {}
    setApplying(false);
  };

  if (loading) return null;

  // Nothing to show if no pooled or manual assets
  const relevantAssets = pooledAssets.length > 0 ? pooledAssets : manualAssets.filter(
    a => a.slot_key?.startsWith("__pool__"),
  );
  if (relevantAssets.length === 0) return null;

  // Pre-visual-direction: just show info
  if (!vdReady) {
    return (
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center gap-3">
            <div className="shrink-0 w-8 h-8 rounded-full bg-blue-500/20 text-blue-300 flex items-center justify-center">
              <Upload className="w-4 h-4" />
            </div>
            <div>
              <p className="text-sm font-medium">
                {relevantAssets.length} {label.toLowerCase()} pooled
              </p>
              <p className="text-xs text-muted-foreground">
                Assets will be assigned to scene slots after Visual Direction completes.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Post-visual-direction: show mapping UI
  return (
    <Card>
      <CardTitle className="flex items-center gap-2 text-base">
        <Upload className="w-4 h-4 text-blue-400" />
        Assign {label} to Scenes
        <Badge variant="outline" className="text-xs">
          {relevantAssets.length} asset{relevantAssets.length !== 1 ? "s" : ""} / {scenes.length} scene{scenes.length !== 1 ? "s" : ""}
        </Badge>
      </CardTitle>
      <CardContent className="mt-3 space-y-3">
        {relevantAssets.map((asset) => (
          <div
            key={asset.id}
            className="flex items-center gap-3 p-3 rounded-lg border border-muted-foreground/10 bg-muted/20"
          >
            {/* Asset preview */}
            <div className="shrink-0 w-16 h-12 bg-muted rounded overflow-hidden flex items-center justify-center">
              {asset.type === "image" && asset.url ? (
                <img src={asset.url} alt="" className="w-full h-full object-cover" />
              ) : asset.type === "video" ? (
                <FileVideo className="w-5 h-5 text-muted-foreground" />
              ) : (
                <FolderOpen className="w-5 h-5 text-muted-foreground" />
              )}
            </div>

            {/* Asset info */}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate">{asset.filename}</p>
              <p className="text-[10px] text-muted-foreground">
                {formatSize(asset.size_bytes)} &middot; {formatDate(asset.created_at)}
              </p>
            </div>

            {/* Scene dropdown */}
            <div className="shrink-0 w-48">
              <Select
                value={String(mappings[asset.id] || "")}
                onChange={(e) =>
                  setMappings(prev => ({ ...prev, [asset.id]: Number(e.target.value) }))
                }
              >
                <option value="">Unassigned</option>
                {scenes.map((scene) => {
                  const filled = isHero ? scene.video_url : scene.image_url;
                  return (
                    <option key={scene.scene_id} value={scene.scene_id}>
                      Scene {scene.scene_id}: {scene.label || scene.prompt.slice(0, 40)}
                      {filled ? " (filled)" : ""}
                    </option>
                  );
                })}
              </Select>
            </div>
          </div>
        ))}

        <div className="flex justify-end pt-1">
          <Button
            size="sm"
            onClick={applyMappings}
            disabled={applying || Object.values(mappings).filter(v => v > 0).length === 0}
          >
            {applying ? (
              <RefreshCw className="w-4 h-4 mr-1.5 animate-spin" />
            ) : (
              <Check className="w-4 h-4 mr-1.5" />
            )}
            {applying ? "Applying..." : "Apply Mapping"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function AssetLibraryPage() {
  const params = useParams();
  const projectId = params.id as string;
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "image" | "audio" | "video">("all");
  const [syncing, setSyncing] = useState(false);
  const [initSlots, setInitSlots] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadModalAssetType, setUploadModalAssetType] = useState<string | undefined>(undefined);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/assets?project_id=${projectId}`);
      const data = await res.json();
      if (data.success) setAssets(data.data.assets || []);
    } catch {}
    setLoading(false);
  }, [projectId]);

  const syncAssets = useCallback(async () => {
    setSyncing(true);
    try {
      await fetch("/api/assets/backfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId }),
      });
      await loadData();
    } catch {}
    setSyncing(false);
  }, [projectId, loadData]);

  const initializeSlots = useCallback(async () => {
    setInitSlots(true);
    try {
      const res = await fetch("/api/assets/init-slots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId }),
      });
      const data = await res.json();
      if (data.success) {
        await loadData();
        alert(`Slots initialized: ${data.data?.summary || "done"}`);
      } else {
        alert(data.error || "Failed to initialize slots");
      }
    } catch (err) {
      alert(`Error: ${String(err)}`);
    }
    setInitSlots(false);
  }, [projectId, loadData]);

  const deleteAsset = useCallback(async (assetId: string) => {
    setDeleting(assetId);
    try {
      const res = await fetch(`/api/assets/${assetId}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) await loadData();
    } catch {}
    setDeleting(null);
  }, [loadData]);

  useEffect(() => { loadData(); }, [loadData]);

  const filteredAssets = filter === "all" ? assets : assets.filter((a) => a.type === filter);

  // Group by step
  const grouped = filteredAssets.reduce<Record<string, AssetRow[]>>((acc, a) => {
    const key = a.step || "unknown";
    if (!acc[key]) acc[key] = [];
    acc[key].push(a);
    return acc;
  }, {});

  const typeIcon = (type: string) => {
    if (type === "image") return <ImageIcon className="w-3.5 h-3.5" />;
    if (type === "audio") return <FileAudio className="w-3.5 h-3.5" />;
    if (type === "video") return <FileVideo className="w-3.5 h-3.5" />;
    return <FolderOpen className="w-3.5 h-3.5" />;
  };

  const totalStorage = assets.reduce((sum, a) => sum + (a.size_bytes || 0), 0);

  const openUploadModal = (assetType?: string) => {
    setUploadModalAssetType(assetType);
    setShowUploadModal(true);
  };

  return (
    <div className="container max-w-5xl mx-auto py-8 px-4 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href={`/projects/${projectId}`}>
          <ArrowLeft className="h-5 w-5 text-muted-foreground hover:text-foreground transition-colors" />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold">Asset Library</h1>
          <p className="text-sm text-muted-foreground">
            View, manage, and upload production assets.
          </p>
          <p className="text-xs text-muted-foreground font-mono select-all mt-0.5">
            ID: {projectId}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={initializeSlots} disabled={initSlots || loading}>
          <FolderOpen className={`h-4 w-4 mr-1 ${initSlots ? "animate-pulse" : ""}`} />
          {initSlots ? "Initializing..." : "Init Slots"}
        </Button>
        <Button variant="ghost" size="sm" onClick={syncAssets} disabled={syncing || loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Syncing..." : "Sync"}
        </Button>
        <Button size="sm" onClick={() => openUploadModal()}>
          <Upload className="h-4 w-4 mr-1.5" />
          Upload Asset
        </Button>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Total Assets</p>
          <p className="text-2xl font-bold">{assets.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Manual Uploads</p>
          <p className="text-2xl font-bold">{assets.filter((a) => a.source === "manual").length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Generated</p>
          <p className="text-2xl font-bold">{assets.filter((a) => a.source === "generated").length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Storage</p>
          <p className="text-2xl font-bold">{formatSize(totalStorage)}</p>
        </Card>
      </div>

      {/* Filter bar */}
      <div className="flex gap-2">
        {(["all", "image", "audio", "video"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
              filter === f
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-muted text-muted-foreground border-transparent hover:border-muted-foreground/30"
            }`}
          >
            {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
            {f !== "all" && ` (${assets.filter((a) => a.type === f).length})`}
          </button>
        ))}
      </div>

      {/* Asset Re-assignment Panels (pooled assets → scene slots) */}
      <AssetReassignmentPanel projectId={projectId} step="image_generation" onMappingApplied={loadData} />
      <AssetReassignmentPanel projectId={projectId} step="hero_scenes" onMappingApplied={loadData} />

      {/* Hero Scenes — prompt reference + per-slot upload */}
      <HeroScenesPanel projectId={projectId} onAssetsChanged={loadData} />

      {/* Asset table grouped by step */}
      {Object.entries(grouped)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([step, stepAssets]) => (
          <Card key={step}>
            <CardTitle className="flex items-center gap-2 text-base">
              {STEP_LABELS[step] || step}
              <Badge variant="outline" className="text-xs">
                {stepAssets.length} asset{stepAssets.length !== 1 ? "s" : ""}
              </Badge>
              <div className="flex-1" />
              <InlineUploadButton
                projectId={projectId}
                step={step}
                onSuccess={loadData}
              />
            </CardTitle>
            <CardContent className="mt-2 p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-muted-foreground/10 text-muted-foreground">
                      <th className="text-left py-2 px-4 font-medium">Type</th>
                      <th className="text-left py-2 px-4 font-medium">Preview</th>
                      <th className="text-left py-2 px-4 font-medium">Slot</th>
                      <th className="text-left py-2 px-4 font-medium">Source</th>
                      <th className="text-left py-2 px-4 font-medium">Size</th>
                      <th className="text-left py-2 px-4 font-medium">Details</th>
                      <th className="text-left py-2 px-4 font-medium">Created</th>
                      <th className="text-right py-2 px-4 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stepAssets.map((asset) => (
                      <tr key={asset.id} className="border-b border-muted-foreground/5 hover:bg-muted/30 transition-colors">
                        <td className="py-2 px-4">
                          <span className="text-muted-foreground">{typeIcon(asset.type)}</span>
                        </td>
                        <td className="py-2 px-4">
                          {asset.url && asset.type === "image" ? (
                            <img src={asset.url} alt="" className="w-12 h-8 object-cover rounded" />
                          ) : asset.url && asset.type === "video" ? (
                            /\.(jpe?g|png|webp)(\?|$)/i.test(asset.url) ? (
                              <img src={asset.url} alt="" className="w-12 h-8 object-cover rounded" />
                            ) : (
                              <div className="w-12 h-8 bg-muted rounded flex items-center justify-center">
                                <FileVideo className="w-3 h-3 text-muted-foreground" />
                              </div>
                            )
                          ) : asset.url && asset.type === "audio" ? (
                            <div className="w-12 h-8 bg-muted rounded flex items-center justify-center">
                              <FileAudio className="w-3 h-3 text-muted-foreground" />
                            </div>
                          ) : (
                            <div className="w-12 h-8 bg-muted rounded" />
                          )}
                        </td>
                        <td className="py-2 px-4 text-muted-foreground">
                          {asset.slot_key || "\u2014"}
                        </td>
                        <td className="py-2 px-4">
                          <Badge
                            variant={asset.source === "manual" ? "default" : "outline"}
                            className="text-[10px]"
                          >
                            {asset.source}
                          </Badge>
                        </td>
                        <td className="py-2 px-4 text-muted-foreground">
                          {formatSize(asset.size_bytes)}
                        </td>
                        <td className="py-2 px-4 text-muted-foreground">
                          {asset.width && asset.height ? `${asset.width}\u00d7${asset.height}` : ""}
                          {asset.duration_ms ? `${(asset.duration_ms / 1000).toFixed(1)}s` : ""}
                        </td>
                        <td className="py-2 px-4 text-muted-foreground">
                          {formatDate(asset.created_at)}
                        </td>
                        <td className="py-2 px-4 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {asset.url && (
                              <a
                                href={asset.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                                title="Open"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            )}
                            <button
                              onClick={() => deleteAsset(asset.id)}
                              disabled={deleting === asset.id}
                              className="p-1 rounded hover:bg-red-500/10 transition-colors text-muted-foreground hover:text-red-400"
                              title="Delete"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        ))}

      {filteredAssets.length === 0 && !loading && (
        <div className="text-center py-12 text-muted-foreground">
          <FolderOpen className="w-10 h-10 mx-auto mb-3 opacity-50" />
          <p className="text-sm">No assets found</p>
          <p className="text-xs mt-1">
            Run the pipeline or{" "}
            <button
              onClick={() => openUploadModal()}
              className="text-primary hover:underline"
            >
              upload assets
            </button>{" "}
            to get started.
          </p>
        </div>
      )}

      {loading && (
        <div className="text-center text-muted-foreground py-8">Loading assets...</div>
      )}

      {/* Upload Modal */}
      {showUploadModal && (
        <UploadModal
          projectId={projectId}
          defaultAssetType={uploadModalAssetType}
          onClose={() => setShowUploadModal(false)}
          onSuccess={loadData}
        />
      )}
    </div>
  );
}
