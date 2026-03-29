"use client";

import { ExternalLink, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

interface ImageEntry {
  url: string;
  prompt: string;
  revised_prompt?: string;
  stored?: boolean;
}

export function ImageGallery({ output, projectId }: {
  output: Record<string, unknown>;
  projectId?: string;
}) {
  const stepImages = (output.images as ImageEntry[]) || [];
  const [mergedImages, setMergedImages] = useState<ImageEntry[]>(stepImages);
  const [fetched, setFetched] = useState(false);

  // Fetch assets from DB to fill in any missing images (e.g. after manual sync)
  const fetchAssets = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/assets?project_id=${projectId}`);
      const data = await res.json();
      if (!data.success || !data.data?.assets) return;

      const dbAssets = (data.data.assets as { url: string; step?: string; metadata?: Record<string, unknown> }[])
        .filter(a => a.step === "image_generation");
      if (dbAssets.length === 0) return;

      // Build merged list: start with step output images, add any DB assets not already present
      const existingUrls = new Set(stepImages.map(img => img.url));
      const extras: ImageEntry[] = dbAssets
        .filter(a => a.url && !existingUrls.has(a.url))
        .map(a => ({
          url: a.url,
          prompt: (a.metadata?.prompt as string) || (a.metadata?.dalle_prompt as string) || "DALL-E image",
          revised_prompt: (a.metadata?.revised_prompt as string) || "",
          stored: true,
        }));

      if (extras.length > 0) {
        setMergedImages([...stepImages, ...extras]);
      }
    } catch {}
    setFetched(true);
  }, [projectId, stepImages]);

  useEffect(() => {
    if (!fetched && stepImages.length === 0 && projectId) {
      fetchAssets();
    }
  }, [fetched, stepImages.length, projectId, fetchAssets]);

  const images = mergedImages.length > 0 ? mergedImages : stepImages;

  if (images.length === 0) {
    return <p className="text-sm text-muted-foreground">No images generated yet.</p>;
  }

  return (
    <div className="space-y-3">
      {mergedImages.length > stepImages.length && (
        <p className="text-xs text-blue-500">
          {mergedImages.length - stepImages.length} image(s) loaded from asset sync
        </p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {images.map((img, i) => (
          <div key={i} className="rounded-lg overflow-hidden border border-muted">
            <a href={img.url} target="_blank" rel="noopener noreferrer" className="block">
              <img
                src={img.url}
                alt={`Scene ${i + 1}`}
                className="w-full h-48 object-cover hover:opacity-80 transition-opacity"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).parentElement!.innerHTML = '<div class="w-full h-48 flex items-center justify-center bg-muted text-xs text-muted-foreground">Image expired or unavailable</div>'; }}
              />
            </a>
            <div className="p-2 flex items-start gap-2">
              <p className="text-xs text-muted-foreground flex-1 line-clamp-2">{img.revised_prompt || img.prompt}</p>
              <a href={img.url} target="_blank" rel="noopener noreferrer" className="shrink-0">
                <ExternalLink className="h-3 w-3 text-muted-foreground hover:text-primary" />
              </a>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {images.length} of {String(output.total_prompts || images.length)} images
        {output.generated ? ` (${output.generated} generated this run)` : ""}
      </p>
    </div>
  );
}
