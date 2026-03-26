"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Image as ImageIcon, FileAudio, FileVideo, Upload, FolderOpen, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AssetGrid } from "@/components/assets/AssetGrid";
import { getSlotsForStep } from "@/lib/asset-validation";
import type { PipelineStep, StepResult } from "@/types";

const ASSET_STEPS: { id: PipelineStep; label: string }[] = [
  { id: "voiceover_generation", label: "Voiceover" },
  { id: "image_generation", label: "Images (DALL-E)" },
  { id: "stock_footage", label: "Stock Footage" },
  { id: "motion_graphics", label: "Motion Graphics" },
  { id: "thumbnail_creation", label: "Thumbnail" },
  { id: "hero_scenes", label: "Hero Scenes" },
];

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

export default function AssetLibraryPage() {
  const params = useParams();
  const projectId = params.id as string;
  const [steps, setSteps] = useState<StepResult[]>([]);
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "image" | "audio" | "video">("all");
  const [backfilling, setBackfilling] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [stepsRes, assetsRes] = await Promise.all([
        fetch(`/api/pipeline/steps?project_id=${projectId}`),
        fetch(`/api/assets?project_id=${projectId}`),
      ]);
      const stepsData = await stepsRes.json();
      const assetsData = await assetsRes.json();
      if (stepsData.success) setSteps(stepsData.data);
      if (assetsData.success) setAssets(assetsData.data.assets || []);
    } catch {}
    setLoading(false);
  }, [projectId]);

  const backfillAssets = useCallback(async () => {
    setBackfilling(true);
    try {
      const res = await fetch("/api/assets/backfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId }),
      });
      const data = await res.json();
      if (data.success) {
        await loadData();
      }
    } catch {}
    setBackfilling(false);
  }, [projectId, loadData]);

  useEffect(() => { loadData(); }, [loadData]);

  const filteredAssets = filter === "all" ? assets : assets.filter((a) => a.type === filter);

  const typeIcon = (type: string) => {
    if (type === "image") return <ImageIcon className="w-4 h-4" />;
    if (type === "audio") return <FileAudio className="w-4 h-4" />;
    if (type === "video") return <FileVideo className="w-4 h-4" />;
    return <FolderOpen className="w-4 h-4" />;
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
            Manage all assets for this project — upload, replace, or delete files per step.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={backfillAssets} disabled={backfilling || loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${backfilling ? "animate-spin" : ""}`} />
          {backfilling ? "Scanning..." : "Sync Assets from Pipeline"}
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
          <p className="text-2xl font-bold">
            {(assets.reduce((sum, a) => sum + (a.size_bytes || 0), 0) / (1024 * 1024)).toFixed(1)}MB
          </p>
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

      {/* Per-step asset grids */}
      {ASSET_STEPS.map((stepDef) => {
        const slots = getSlotsForStep(stepDef.id);
        if (slots.length === 0) return null;
        const stepData = steps.find((s) => s.step === stepDef.id);
        const output = (stepData?.output || {}) as Record<string, unknown>;
        const stepAssets = filteredAssets.filter((a) => a.step === stepDef.id);

        return (
          <Card key={stepDef.id}>
            <CardTitle className="flex items-center gap-2 text-base">
              {stepDef.label}
              <Badge variant="outline" className="text-xs">
                {stepAssets.length} asset{stepAssets.length !== 1 ? "s" : ""}
              </Badge>
              {stepData?.status && (
                <Badge variant={stepData.status === "completed" ? "success" : "outline"} className="text-xs">
                  {stepData.status}
                </Badge>
              )}
            </CardTitle>
            <CardContent className="mt-4">
              <AssetGrid
                projectId={projectId}
                step={stepDef.id}
                output={output}
                onOutputChanged={loadData}
              />
              {/* Existing assets metadata */}
              {stepAssets.length > 0 && (
                <div className="mt-3 pt-3 border-t border-muted-foreground/10">
                  <p className="text-xs font-medium text-muted-foreground mb-2">Asset Details</p>
                  <div className="space-y-1">
                    {stepAssets.map((asset) => (
                      <div key={asset.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                        {typeIcon(asset.type)}
                        <span className="truncate flex-1">{asset.slot_key || asset.filename}</span>
                        <Badge variant="outline" className="text-[10px]">{asset.source}</Badge>
                        {asset.size_bytes > 0 && (
                          <span>{(asset.size_bytes / 1024).toFixed(0)}KB</span>
                        )}
                        {asset.width && asset.height && (
                          <span>{asset.width}x{asset.height}</span>
                        )}
                        {asset.duration_ms && (
                          <span>{(asset.duration_ms / 1000).toFixed(1)}s</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      {loading && (
        <div className="text-center text-muted-foreground py-8">Loading assets...</div>
      )}
    </div>
  );
}
