"use client";

export function AudioPlayer({ output }: {
  output: Record<string, unknown>;
}) {
  return (
    <div className="space-y-2">
      {typeof output.audio_url === "string" && (
        <audio controls className="w-full" src={output.audio_url}>
          Your browser does not support the audio element.
        </audio>
      )}
      <div className="flex gap-4 text-xs text-muted-foreground">
        <span>Words: {String(output.word_count || "—")}</span>
        <span>Est. duration: {String(output.estimated_duration_minutes || "—")} min</span>
        <span>Voice: {String(output.voice_id || "—")}</span>
      </div>
      {!output.audio_url && typeof output.note === "string" && (
        <p className="text-xs text-yellow-500">{output.note}</p>
      )}
    </div>
  );
}
