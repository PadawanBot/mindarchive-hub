"use client";

import { useRef, useState, useCallback } from "react";
import { Upload, Replace, Trash2, FileVideo, FileAudio, ImageIcon, Loader2, AlertCircle } from "lucide-react";
import type { AssetSlotDef } from "@/lib/asset-validation";

interface AssetSlotProps {
  projectId: string;
  slotDef: AssetSlotDef;
  currentUrl: string | null;
  onAssetChanged: () => void;
}

const SIZE_THRESHOLD = 4 * 1024 * 1024; // 4MB — Vercel body limit

export function AssetSlot({ projectId, slotDef, currentUrl, onAssetChanged }: AssetSlotProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const accept = slotDef.acceptMimeTypes.join(",");

  // Client-side validation for dimensions/duration
  const validateClientSide = useCallback(async (file: File): Promise<{ width?: number; height?: number; durationMs?: number; error?: string }> => {
    if (slotDef.mimeCategory === "image") {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const dims = slotDef.dimensions;
          if (dims && (img.width < dims.minW || img.height < dims.minH)) {
            resolve({ error: `Image too small (${img.width}x${img.height}). Min: ${dims.minW}x${dims.minH}` });
          } else {
            resolve({ width: img.width, height: img.height });
          }
          URL.revokeObjectURL(img.src);
        };
        img.onerror = () => resolve({});
        img.src = URL.createObjectURL(file);
      });
    }
    if (slotDef.mimeCategory === "video" || slotDef.mimeCategory === "audio") {
      return new Promise((resolve) => {
        const el = document.createElement(slotDef.mimeCategory === "video" ? "video" : "audio");
        el.onloadedmetadata = () => {
          const durationMs = Math.round(el.duration * 1000);
          if (slotDef.maxDurationMs && durationMs > slotDef.maxDurationMs) {
            resolve({ error: `Duration too long (${Math.round(el.duration)}s). Max: ${Math.round(slotDef.maxDurationMs / 1000)}s` });
          } else {
            const result: { durationMs: number; width?: number; height?: number } = { durationMs };
            if (slotDef.mimeCategory === "video") {
              result.width = (el as HTMLVideoElement).videoWidth;
              result.height = (el as HTMLVideoElement).videoHeight;
            }
            resolve(result);
          }
          URL.revokeObjectURL(el.src);
        };
        el.onerror = () => resolve({});
        el.src = URL.createObjectURL(file);
      });
    }
    return {};
  }, [slotDef]);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ""; // Reset for re-upload

    setError(null);
    setUploading(true);

    try {
      // Client-side validation
      const clientValidation = await validateClientSide(file);
      if (clientValidation.error) {
        setError(clientValidation.error);
        setUploading(false);
        return;
      }

      if (file.size <= SIZE_THRESHOLD) {
        // Small file: upload via API route
        const formData = new FormData();
        formData.append("file", file);
        formData.append("project_id", projectId);
        formData.append("step", slotDef.step);
        formData.append("slot_key", slotDef.slotKey);
        if (clientValidation.width) formData.append("width", String(clientValidation.width));
        if (clientValidation.height) formData.append("height", String(clientValidation.height));
        if (clientValidation.durationMs) formData.append("duration_ms", String(clientValidation.durationMs));

        const res = await fetch("/api/assets/upload", { method: "POST", body: formData });
        const data = await res.json();
        if (!data.success) throw new Error(data.error);
      } else {
        // Large file: get signed URL, upload directly, then confirm
        const urlRes = await fetch("/api/assets/upload-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project_id: projectId,
            step: slotDef.step,
            slot_key: slotDef.slotKey,
            mime_type: file.type,
            size_bytes: file.size,
          }),
        });
        const urlData = await urlRes.json();
        if (!urlData.success) throw new Error(urlData.error);

        // Direct upload to Supabase
        const uploadRes = await fetch(urlData.data.upload_url, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        });
        if (!uploadRes.ok) throw new Error("Direct upload failed");

        // Confirm the upload
        const confirmRes = await fetch("/api/assets/confirm-upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project_id: projectId,
            step: slotDef.step,
            slot_key: slotDef.slotKey,
            storage_path: urlData.data.storage_path,
            filename: urlData.data.filename,
            mime_type: file.type,
            size_bytes: file.size,
            width: clientValidation.width,
            height: clientValidation.height,
            duration_ms: clientValidation.durationMs,
          }),
        });
        const confirmData = await confirmRes.json();
        if (!confirmData.success) throw new Error(confirmData.error);
      }

      onAssetChanged();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setUploading(false);
    }
  }, [projectId, slotDef, validateClientSide, onAssetChanged]);

  const handleDelete = useCallback(async () => {
    // For now, delete by re-uploading null — the full delete needs the asset ID
    // which we'd need to fetch from the API. For MVP, we'll use the upload flow.
    setDeleting(true);
    setError(null);
    try {
      // Fetch assets to find the one for this slot
      const res = await fetch(`/api/assets?project_id=${projectId}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      const asset = data.data.assets.find(
        (a: { step: string; slot_key: string }) => a.step === slotDef.step && a.slot_key === slotDef.slotKey
      );
      if (!asset) throw new Error("Asset record not found");

      const delRes = await fetch(`/api/assets/${asset.id}`, { method: "DELETE" });
      const delData = await delRes.json();
      if (!delData.success) throw new Error(delData.error);

      onAssetChanged();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setDeleting(false);
    }
  }, [projectId, slotDef, onAssetChanged]);

  const PlaceholderIcon = slotDef.mimeCategory === "video" ? FileVideo
    : slotDef.mimeCategory === "audio" ? FileAudio
    : ImageIcon;

  return (
    <div className="relative group rounded-lg border border-dashed border-muted-foreground/30 hover:border-primary/50 transition-colors overflow-hidden bg-muted/20">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={handleFileSelect}
        disabled={uploading || deleting}
      />

      {/* Content area */}
      <div className="aspect-video flex items-center justify-center relative">
        {currentUrl ? (
          <>
            {slotDef.mimeCategory === "image" && (
              <img
                src={currentUrl}
                alt={slotDef.label}
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            )}
            {slotDef.mimeCategory === "video" && (
              // If URL is an image (thumbnail preview), render as <img>; otherwise <video>
              /\.(jpe?g|png|webp)(\?|$)/i.test(currentUrl) ? (
                <img src={currentUrl} alt={slotDef.label} className="w-full h-full object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              ) : (
                <video src={currentUrl} className="w-full h-full object-cover" muted
                  onError={(e) => { (e.target as HTMLVideoElement).style.display = "none"; }} />
              )
            )}
            {slotDef.mimeCategory === "audio" && (
              <div className="flex flex-col items-center gap-2 p-4 w-full">
                <FileAudio className="w-8 h-8 text-muted-foreground" />
                <audio controls src={currentUrl} className="w-full" />
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground/60">
            <PlaceholderIcon className="w-10 h-10" />
            <span className="text-xs">Empty</span>
          </div>
        )}

        {/* Overlay buttons */}
        {!uploading && !deleting && (
          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="p-2 rounded-full bg-white/20 hover:bg-white/40 text-white transition-colors"
              title={currentUrl ? "Replace" : "Upload"}
            >
              {currentUrl ? <Replace className="w-4 h-4" /> : <Upload className="w-4 h-4" />}
            </button>
            {currentUrl && (
              <button
                onClick={handleDelete}
                className="p-2 rounded-full bg-red-500/30 hover:bg-red-500/60 text-white transition-colors"
                title="Delete"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        )}

        {/* Loading state */}
        {(uploading || deleting) && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
            <Loader2 className="w-6 h-6 text-white animate-spin" />
          </div>
        )}
      </div>

      {/* Label */}
      <div className="px-2 py-1.5 text-xs text-muted-foreground truncate border-t border-muted-foreground/10">
        {slotDef.label}
      </div>

      {/* Error */}
      {error && (
        <div className="px-2 py-1 text-xs text-red-400 flex items-center gap-1 border-t border-red-500/20 bg-red-500/10">
          <AlertCircle className="w-3 h-3 flex-shrink-0" />
          <span className="truncate">{error}</span>
        </div>
      )}
    </div>
  );
}
