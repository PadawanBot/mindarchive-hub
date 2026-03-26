"use client";

import { useState, useCallback } from "react";

interface AssemblyScene {
  imageUrl: string;
  duration: number; // seconds
}

interface AssemblyProgress {
  stage: string;
  percent: number;
  detail?: string;
}

/**
 * Browser-side video assembly using ffmpeg.wasm.
 * No external services needed — runs entirely in the browser.
 */
export function useVideoAssembler() {
  const [assembling, setAssembling] = useState(false);
  const [progress, setProgress] = useState<AssemblyProgress>({ stage: "idle", percent: 0 });
  const [error, setError] = useState<string | null>(null);

  const assemble = useCallback(async (
    voiceoverUrl: string,
    scenes: AssemblyScene[],
    outputFilename: string = "video.mp4"
  ) => {
    setAssembling(true);
    setError(null);
    setProgress({ stage: "Loading ffmpeg", percent: 5 });

    try {
      // Dynamically import ffmpeg.wasm (25MB download, cached after first use)
      const { FFmpeg } = await import("@ffmpeg/ffmpeg");
      const { fetchFile } = await import("@ffmpeg/util");

      const ffmpeg = new FFmpeg();

      ffmpeg.on("progress", ({ progress: p }) => {
        setProgress({
          stage: "Rendering video",
          percent: 40 + Math.round(p * 50),
          detail: `${Math.round(p * 100)}% encoded`,
        });
      });

      setProgress({ stage: "Loading ffmpeg engine", percent: 10 });
      await ffmpeg.load({
        coreURL: "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js",
        wasmURL: "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.wasm",
      });

      // Download voiceover
      setProgress({ stage: "Downloading voiceover", percent: 15 });
      const audioData = await fetchFile(voiceoverUrl);
      await ffmpeg.writeFile("voiceover.mp3", audioData);

      // Download scene images
      const validScenes: { file: string; duration: number }[] = [];
      for (let i = 0; i < scenes.length; i++) {
        setProgress({
          stage: "Downloading images",
          percent: 15 + Math.round((i / scenes.length) * 15),
          detail: `Image ${i + 1}/${scenes.length}`,
        });
        try {
          const imgData = await fetchFile(scenes[i].imageUrl);
          const ext = scenes[i].imageUrl.includes(".png") ? "png" : "jpg";
          const filename = `scene${i}.${ext}`;
          await ffmpeg.writeFile(filename, imgData);
          validScenes.push({ file: filename, duration: scenes[i].duration });
        } catch {
          console.warn(`Failed to download scene ${i}`);
        }
      }

      if (validScenes.length === 0) {
        throw new Error("No images could be downloaded. Check that image URLs are accessible.");
      }

      setProgress({ stage: "Creating video clips", percent: 35 });

      // Create individual clips from each image (simple zoom effect)
      const clipFiles: string[] = [];
      for (let i = 0; i < validScenes.length; i++) {
        const scene = validScenes[i];
        const clipName = `clip${i}.mp4`;
        setProgress({
          stage: "Creating video clips",
          percent: 35 + Math.round((i / validScenes.length) * 10),
          detail: `Clip ${i + 1}/${validScenes.length}`,
        });

        await ffmpeg.exec([
          "-loop", "1",
          "-i", scene.file,
          "-c:v", "libx264",
          "-t", String(scene.duration),
          "-pix_fmt", "yuv420p",
          "-vf", `scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,zoompan=z='min(zoom+0.001,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${scene.duration * 25}:s=1920x1080:fps=25`,
          "-preset", "ultrafast",
          "-r", "25",
          clipName,
        ]);
        clipFiles.push(clipName);
      }

      // Create concat list
      setProgress({ stage: "Joining clips", percent: 50 });
      const concatList = clipFiles.map(f => `file '${f}'`).join("\n");
      await ffmpeg.writeFile("concat.txt", concatList);

      // Concatenate clips
      await ffmpeg.exec([
        "-f", "concat",
        "-safe", "0",
        "-i", "concat.txt",
        "-c", "copy",
        "slideshow.mp4",
      ]);

      // Merge with audio
      setProgress({ stage: "Merging audio", percent: 70 });
      await ffmpeg.exec([
        "-i", "slideshow.mp4",
        "-i", "voiceover.mp3",
        "-c:v", "copy",
        "-c:a", "aac",
        "-b:a", "192k",
        "-shortest",
        "-movflags", "+faststart",
        "output.mp4",
      ]);

      setProgress({ stage: "Preparing download", percent: 95 });

      // Read the output file
      const outputData = await ffmpeg.readFile("output.mp4");
      const blob = new Blob([outputData], { type: "video/mp4" });
      const url = URL.createObjectURL(blob);

      // Trigger download
      const a = document.createElement("a");
      a.href = url;
      a.download = outputFilename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      // Cleanup
      setTimeout(() => URL.revokeObjectURL(url), 60000);

      setProgress({ stage: "Complete", percent: 100 });

      // Cleanup ffmpeg files
      try {
        await ffmpeg.terminate();
      } catch {}

      return url;
    } catch (err) {
      const msg = String(err);
      setError(msg);
      setProgress({ stage: "Failed", percent: 0, detail: msg });
      return null;
    } finally {
      setAssembling(false);
    }
  }, []);

  return { assemble, assembling, progress, error };
}
