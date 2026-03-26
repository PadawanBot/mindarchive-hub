"use client";

export function TextOutput({ text }: { text: string }) {
  return (
    <pre className="whitespace-pre-wrap text-sm bg-muted p-4 rounded-lg max-h-64 overflow-y-auto">
      {text}
    </pre>
  );
}
