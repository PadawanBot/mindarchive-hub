"use client";

export function StockFootageGrid({ output }: {
  output: Record<string, unknown>;
}) {
  const footage = output.footage as { query: string; videos: { url: string; file_url?: string; thumbnail?: string; duration: number }[] }[];

  return (
    <div className="space-y-3">
      {footage.map((group, i) => (
        <div key={i}>
          <p className="text-xs font-medium text-muted-foreground mb-2">Search: &ldquo;{group.query}&rdquo;</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {group.videos.map((v, j) => (
              <a key={j} href={v.file_url || v.url} target="_blank" rel="noopener noreferrer"
                className="block rounded-lg overflow-hidden border border-muted hover:border-primary/50 transition-colors">
                {v.thumbnail ? (
                  <img src={v.thumbnail} alt={`Stock clip ${j + 1}`}
                    className="w-full aspect-video object-cover" />
                ) : (
                  <div className="w-full aspect-video bg-muted flex items-center justify-center">
                    <span className="text-xs text-muted-foreground">No preview</span>
                  </div>
                )}
                <div className="px-2 py-1 text-xs text-muted-foreground">
                  Video {j + 1} ({v.duration}s)
                </div>
              </a>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
