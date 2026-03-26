"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function HeroScenesViewer({ scenes, skipped, reason, projectId }: {
  scenes: { task_id?: string; taskId?: string; status?: string; video_url?: string; image_url?: string; imageUrl?: string; prompt?: string; promptText?: string }[];
  skipped?: boolean;
  reason?: string;
  projectId?: string;
}) {
  const [sceneStatuses, setSceneStatuses] = useState<Record<number, { status: string; videoUrl?: string }>>({});
  const [polling, setPolling] = useState(false);
  const [autoPolling, setAutoPolling] = useState(false);
  const [persisting, setPersisting] = useState<Record<number, boolean>>({});

  // Persist a succeeded Runway video: download to Supabase Storage, then update step output
  const persistVideo = useCallback(async (index: number, sourceUrl: string) => {
    if (!projectId || persisting[index]) return;
    setPersisting(prev => ({ ...prev, [index]: true }));
    try {
      // Download to Supabase Storage
      const storeRes = await fetch("/api/pipeline/persist-asset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          filename: `hero_scene_${index + 1}.mp4`,
          source_url: sourceUrl,
          mime_type: "video/mp4",
        }),
      });
      const storeData = await storeRes.json();
      const permanentUrl = storeData.success ? storeData.data.url : sourceUrl;

      // Update step output with permanent video_url
      const updatedScenes = scenes.map((s, i) =>
        i === index ? { ...s, video_url: permanentUrl } : s
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

      // Update local state with permanent URL
      setSceneStatuses(prev => ({
        ...prev,
        [index]: { status: "SUCCEEDED", videoUrl: permanentUrl },
      }));
    } catch (err) {
      console.warn(`Failed to persist hero scene ${index + 1}:`, err);
    }
    setPersisting(prev => ({ ...prev, [index]: false }));
  }, [projectId, scenes, persisting]);

  const checkStatus = useCallback(async () => {
    setPolling(true);
    for (let i = 0; i < scenes.length; i++) {
      const taskId = scenes[i].task_id || scenes[i].taskId;
      if (!taskId || taskId.startsWith("error:")) continue;
      // Skip already succeeded/failed tasks that have a video_url
      const existing = sceneStatuses[i];
      if (existing?.status === "SUCCEEDED" && existing?.videoUrl) continue;
      if (existing?.status === "FAILED") continue;
      if (scenes[i].video_url) continue;
      try {
        const res = await fetch(`/api/pipeline/runway/status?task_id=${taskId}`);
        const data = await res.json();
        if (data.success) {
          setSceneStatuses(prev => ({
            ...prev,
            [i]: { status: data.data.status, videoUrl: data.data.outputUrl },
          }));
          // When a task succeeds, persist the video
          if (data.data.status === "SUCCEEDED" && data.data.outputUrl && projectId) {
            persistVideo(i, data.data.outputUrl);
          }
        }
      } catch {}
    }
    setPolling(false);
  }, [scenes, sceneStatuses, projectId, persistVideo]);

  const hasTaskIds = scenes.some(s => (s.task_id || s.taskId) && !(s.task_id || s.taskId)?.startsWith("error:"));

  // Determine if there are any tasks still in-progress
  const hasInProgress = scenes.some((s, i) => {
    const taskId = s.task_id || s.taskId;
    if (!taskId || taskId.startsWith("error:")) return false;
    if (s.video_url) return false;
    const polled = sceneStatuses[i];
    if (!polled) return true; // Not yet polled — assume in-progress
    return polled.status !== "SUCCEEDED" && polled.status !== "FAILED";
  });

  // Auto-polling: start on mount if there are in-progress tasks, stop when all done
  useEffect(() => {
    if (!hasTaskIds || !hasInProgress) {
      setAutoPolling(false);
      return;
    }
    setAutoPolling(true);
    // Initial check
    checkStatus();
    const interval = setInterval(() => {
      checkStatus();
    }, 10000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasTaskIds, hasInProgress]);

  return (
    <div className="space-y-2">
      {hasInProgress && hasTaskIds && (
        <div className="flex items-center gap-2 p-2 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
          <Loader2 className="h-3 w-3 animate-spin text-yellow-500" />
          <span className="text-xs text-yellow-500 font-medium">Videos rendering... auto-checking every 10s</span>
        </div>
      )}
      {scenes.map((scene, i) => {
        const taskId = scene.task_id || scene.taskId;
        const imgUrl = scene.image_url || scene.imageUrl;
        const prompt = scene.prompt || scene.promptText;
        const polledStatus = sceneStatuses[i];
        const videoUrl = polledStatus?.videoUrl || scene.video_url;
        const status = polledStatus?.status || scene.status || (taskId ? "PENDING" : "no task");

        return (
          <div key={i} className="flex items-center gap-3 p-2 bg-muted rounded-lg">
            {imgUrl ? (
              <img src={imgUrl} alt={`Hero ${i + 1}`} className="w-20 h-12 object-cover rounded"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            ) : (
              <div className="w-20 h-12 bg-background rounded flex items-center justify-center text-xs text-muted-foreground">No img</div>
            )}
            <div className="flex-1">
              <p className="text-xs font-medium">Hero Scene {i + 1}</p>
              <p className="text-xs text-muted-foreground">
                {taskId && !taskId.startsWith("error:")
                  ? `Status: ${status}`
                  : taskId?.startsWith("error:")
                    ? `Error: ${taskId.replace("error: ", "")}`
                    : "No Runway task started"}
              </p>
              {prompt && <p className="text-xs text-muted-foreground/70 line-clamp-1">{prompt}</p>}
              {persisting[i] && <p className="text-xs text-blue-400">Saving video to storage...</p>}
            </div>
            {videoUrl ? (
              <a href={videoUrl} target="_blank" rel="noopener noreferrer"
                className="text-xs bg-primary text-primary-foreground px-2 py-1 rounded hover:opacity-80">Watch</a>
            ) : status === "SUCCEEDED" ? (
              <span className="text-xs text-green-500">Ready</span>
            ) : null}
          </div>
        );
      })}
      {hasTaskIds && (
        <Button variant="outline" size="sm" onClick={checkStatus} disabled={polling} className="mt-2">
          {polling ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Checking...</> : <><RefreshCw className="h-3 w-3 mr-1" /> Check Runway Status</>}
        </Button>
      )}
      {skipped && reason && <p className="text-xs text-yellow-500">{reason}</p>}
    </div>
  );
}
