import { createClient } from "@supabase/supabase-js";
import ffmpeg from "fluent-ffmpeg";
import * as fs from "fs/promises";
import * as path from "path";
import { v4 as uuid } from "uuid";

export interface AssemblyManifest {
  projectId: string;
  projectTitle: string;
  // Audio
  voiceover: {
    url: string;
    durationMinutes: number;
    wordCount: number;
  };
  // Visuals — ordered by timestamp
  scenes: {
    imageUrl: string;
    startTime: number; // seconds
    endTime: number; // seconds
    transition: string; // fade, cut, dissolve
    overlayText?: string;
  }[];
  // Brand
  brand?: {
    lowerThirdFont?: string;
    lowerThirdColor?: string;
    lowerThirdBg?: string;
  };
  // Motion graphics overlays
  motionGraphics?: {
    lowerThirds?: {
      text: string;
      startTime: number;
      endTime: number;
      position?: string;
    }[];
  };
  // Output config
  resolution?: { width: number; height: number };
  fps?: number;
  // Supabase config for uploading result
  supabaseUrl: string;
  supabaseKey: string;
}

interface AssemblyResult {
  outputUrl: string;
  durationSeconds: number;
  fileSizeBytes: number;
}

const WORK_DIR = "/tmp/mindarchive-assembly";

async function ensureWorkDir(jobId: string): Promise<string> {
  const dir = path.join(WORK_DIR, jobId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function downloadFile(url: string, destPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${url} (${response.status})`);
  const buffer = await response.arrayBuffer();
  await fs.writeFile(destPath, Buffer.from(buffer));
}

async function getAudioDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      resolve(metadata.format.duration || 0);
    });
  });
}

export async function assembleVideo(
  manifest: AssemblyManifest,
  onProgress: (pct: number) => void
): Promise<AssemblyResult> {
  const jobId = uuid();
  const workDir = await ensureWorkDir(jobId);
  const resolution = manifest.resolution || { width: 1920, height: 1080 };
  const fps = manifest.fps || 30;

  try {
    // ── Phase 1: Download assets ──
    onProgress(10);

    // Download voiceover
    const audioPath = path.join(workDir, "voiceover.mp3");
    await downloadFile(manifest.voiceover.url, audioPath);
    onProgress(20);

    // Get actual audio duration (this is the production clock)
    const audioDuration = await getAudioDuration(audioPath);

    // Download scene images
    const imagePaths: string[] = [];
    for (let i = 0; i < manifest.scenes.length; i++) {
      const scene = manifest.scenes[i];
      const ext = scene.imageUrl.includes(".png") ? "png" : "jpg";
      const imgPath = path.join(workDir, `scene-${i}.${ext}`);
      try {
        await downloadFile(scene.imageUrl, imgPath);
        imagePaths.push(imgPath);
      } catch {
        console.warn(`Failed to download scene ${i}: ${scene.imageUrl}`);
        imagePaths.push(""); // placeholder
      }
      onProgress(20 + Math.floor((i / manifest.scenes.length) * 20));
    }

    onProgress(40);

    // ── Phase 2: Create image slideshow video ──

    // Generate ffmpeg input file list with durations
    const scenes = manifest.scenes.map((s, i) => ({
      ...s,
      path: imagePaths[i],
      duration: s.endTime - s.startTime,
    })).filter(s => s.path); // skip failed downloads

    // If no valid scenes, create a black video with the audio
    if (scenes.length === 0) {
      const outputPath = path.join(workDir, "output.mp4");
      await new Promise<void>((resolve, reject) => {
        ffmpeg()
          .input(audioPath)
          .inputOptions(["-f", "lavfi", "-i", `color=c=black:s=${resolution.width}x${resolution.height}:d=${audioDuration}:r=${fps}`])
          .outputOptions([
            "-c:v", "libx264",
            "-c:a", "aac",
            "-b:a", "192k",
            "-shortest",
            "-pix_fmt", "yuv420p",
          ])
          .output(outputPath)
          .on("end", () => resolve())
          .on("error", reject)
          .run();
      });
      onProgress(80);
      return await uploadResult(manifest, workDir, outputPath, audioDuration, onProgress);
    }

    // Create concat file for ffmpeg
    const concatPath = path.join(workDir, "concat.txt");
    let concatContent = "";
    for (const scene of scenes) {
      // Use ffmpeg to create a video clip from each image with Ken Burns effect
      const clipPath = path.join(workDir, `clip-${scenes.indexOf(scene)}.mp4`);
      await createImageClip(
        scene.path,
        clipPath,
        scene.duration,
        resolution,
        fps
      );
      concatContent += `file '${clipPath}'\n`;
    }
    await fs.writeFile(concatPath, concatContent);

    onProgress(60);

    // ── Phase 3: Concat clips + merge audio ──
    const slideshowPath = path.join(workDir, "slideshow.mp4");
    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(concatPath)
        .inputOptions(["-f", "concat", "-safe", "0"])
        .outputOptions([
          "-c:v", "libx264",
          "-pix_fmt", "yuv420p",
          "-r", String(fps),
        ])
        .output(slideshowPath)
        .on("end", () => resolve())
        .on("error", reject)
        .run();
    });

    onProgress(70);

    // Merge slideshow with audio
    const outputPath = path.join(workDir, "output.mp4");
    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(slideshowPath)
        .input(audioPath)
        .outputOptions([
          "-c:v", "libx264",
          "-c:a", "aac",
          "-b:a", "192k",
          "-shortest",
          "-pix_fmt", "yuv420p",
          "-movflags", "+faststart",
        ])
        .output(outputPath)
        .on("end", () => resolve())
        .on("error", reject)
        .run();
    });

    onProgress(85);

    // ── Phase 4: Upload to Supabase Storage ──
    return await uploadResult(manifest, workDir, outputPath, audioDuration, onProgress);
  } finally {
    // Cleanup
    try {
      await fs.rm(workDir, { recursive: true, force: true });
    } catch {}
  }
}

async function createImageClip(
  imagePath: string,
  outputPath: string,
  duration: number,
  resolution: { width: number; height: number },
  fps: number
): Promise<void> {
  // Ken Burns effect: slow zoom from 100% to 110% over the clip duration
  const zoomRate = 0.0015; // slow zoom per frame
  return new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(imagePath)
      .inputOptions(["-loop", "1"])
      .outputOptions([
        "-vf", `scale=${resolution.width * 2}:${resolution.height * 2},zoompan=z='min(zoom+${zoomRate},1.1)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${Math.ceil(duration * fps)}:s=${resolution.width}x${resolution.height}:fps=${fps}`,
        "-c:v", "libx264",
        "-t", String(duration),
        "-pix_fmt", "yuv420p",
      ])
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", reject)
      .run();
  });
}

async function uploadResult(
  manifest: AssemblyManifest,
  workDir: string,
  outputPath: string,
  audioDuration: number,
  onProgress: (pct: number) => void
): Promise<AssemblyResult> {
  const fileBuffer = await fs.readFile(outputPath);
  const fileSizeBytes = fileBuffer.length;

  onProgress(90);

  const sb = createClient(manifest.supabaseUrl, manifest.supabaseKey);
  const storagePath = `${manifest.projectId}/final-video.mp4`;

  const { error } = await sb.storage
    .from("project-assets")
    .upload(storagePath, fileBuffer, {
      contentType: "video/mp4",
      upsert: true,
    });

  if (error) throw new Error(`Upload failed: ${error.message}`);

  const { data } = sb.storage.from("project-assets").getPublicUrl(storagePath);

  onProgress(100);

  return {
    outputUrl: data.publicUrl,
    durationSeconds: Math.round(audioDuration),
    fileSizeBytes,
  };
}
