"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Image as ImageIcon,
  FileAudio,
  FileVideo,
  FolderOpen,
  RefreshCw,
  ExternalLink,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";

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
};

function formatSize(bytes: number): string {
  if (bytes === 0) return "—";
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

export default function AssetLibraryPage() {
  const params = useParams();
  const projectId = params.id as string;
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "image" | "audio" | "video">("all");
  const [syncing, setSyncing] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

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
            View and manage all production assets. Upload and replace assets on the{" "}
            <Link href={`/projects/${projectId}`} className="text-primary hover:underline">
              Pipeline tab
            </Link>.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={syncAssets} disabled={syncing || loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Syncing..." : "Sync"}
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
                          {asset.slot_key || "—"}
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
                          {asset.width && asset.height ? `${asset.width}×${asset.height}` : ""}
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
            <Link href={`/projects/${projectId}`} className="text-primary hover:underline">
              upload assets
            </Link>{" "}
            on the Pipeline tab
          </p>
        </div>
      )}

      {loading && (
        <div className="text-center text-muted-foreground py-8">Loading assets...</div>
      )}
    </div>
  );
}
