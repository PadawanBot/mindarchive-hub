"use client";

import { ExternalLink } from "lucide-react";

export function ImageGallery({ output }: {
  output: Record<string, unknown>;
}) {
  const images = output.images as { url: string; prompt: string; revised_prompt: string; stored?: boolean }[];

  return (
    <div className="space-y-3">
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
      <p className="text-xs text-muted-foreground">{String(output.generated)} of {String(output.total_prompts)} images generated</p>
    </div>
  );
}
