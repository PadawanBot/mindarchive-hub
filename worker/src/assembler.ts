import { createClient } from "@supabase/supabase-js";
import ffmpeg from "fluent-ffmpeg";
import * as fs from "fs/promises";
import * as path from "path";
import { v4 as uuid } from "uuid";

import type {
  AssemblyManifestV2,
  AssemblyResultV2,
  Scene,
  LowerThird,
} from "./types";
import {
  prepareDalleScene,
  prepareVideoScene,
  prepareMotionGraphicScene,
  prepareEndCard,
  buildCombinedAudio,
  createPortraitVersion,
} from "./scene-handlers";
import { buildFfmpegArgs } from "./filter-graph";

// ═══════════════════════════════════════════════════════════════
// V1 Legacy types & assembler (kept for backward compatibility)
// ═══════════════════════════════════════════════════════════════

export interface AssemblyManifest {
  projectId: string;
  projectTitle: string;
  voiceover: {
    url: string;
    durationMinutes: number;
    wordCount: number;
  };
  scenes: {
    imageUrl: string;
    startTime: number;
    endTime: number;
    transition: string;
    overlayText?: string;
  }[];
  brand?: {
    lowerThirdFont?: string;
    lowerThirdColor?: string;
    lowerThirdBg?: string;
  };
  motionGraphics?: {
    lowerThirds?: {
      text: string;
      startTime: number;
      endTime: number;
      position?: string;
    }[];
  };
  resolution?: { width: number; height: number };
  fps?: number;
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
  if (!response.ok)
    throw new Error(`Download failed: ${url} (${response.status})`);
  const buffer = await response.arrayBuffer();
  await fs.writeFile(destPath, Buffer.from(buffer));
}

/**
 * Download with retries (2 attempts, exponential backoff).
 */
async function downloadFileRetry(
  url: string,
  destPath: string,
  retries = 2
): Promise<void> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await downloadFile(url, destPath);
      return;
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
}

function getAudioDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      resolve(metadata.format.duration || 0);
    });
  });
}

// ── V1 assembler (unchanged) ──

export async function assembleVideo(
  manifest: AssemblyManifest,
  onProgress: (pct: number) => void
): Promise<AssemblyResult> {
  const jobId = uuid();
  const workDir = await ensureWorkDir(jobId);
  const resolution = manifest.resolution || { width: 1920, height: 1080 };
  const fps = manifest.fps || 30;

  try {
    onProgress(10);

    const audioPath = path.join(workDir, "voiceover.mp3");
    await downloadFile(manifest.voiceover.url, audioPath);
    onProgress(20);

    const audioDuration = await getAudioDuration(audioPath);

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
        imagePaths.push("");
      }
      onProgress(20 + Math.floor((i / manifest.scenes.length) * 20));
    }

    onProgress(40);

    const scenes = manifest.scenes
      .map((s, i) => ({
        ...s,
        path: imagePaths[i],
        duration: s.endTime - s.startTime,
      }))
      .filter((s) => s.path);

    if (scenes.length === 0) {
      const outputPath = path.join(workDir, "output.mp4");
      await new Promise<void>((resolve, reject) => {
        ffmpeg()
          .input(audioPath)
          .inputOptions([
            "-f",
            "lavfi",
            "-i",
            `color=c=black:s=${resolution.width}x${resolution.height}:d=${audioDuration}:r=${fps}`,
          ])
          .outputOptions([
            "-c:v",
            "libx264",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-shortest",
            "-pix_fmt",
            "yuv420p",
          ])
          .output(outputPath)
          .on("end", () => resolve())
          .on("error", reject)
          .run();
      });
      onProgress(80);
      return await uploadResultV1(
        manifest,
        workDir,
        outputPath,
        audioDuration,
        onProgress
      );
    }

    const concatPath = path.join(workDir, "concat.txt");
    let concatContent = "";
    for (const scene of scenes) {
      const clipPath = path.join(
        workDir,
        `clip-${scenes.indexOf(scene)}.mp4`
      );
      await createImageClip(scene.path, clipPath, scene.duration, resolution, fps);
      concatContent += `file '${clipPath}'\n`;
    }
    await fs.writeFile(concatPath, concatContent);

    onProgress(60);

    const slideshowPath = path.join(workDir, "slideshow.mp4");
    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(concatPath)
        .inputOptions(["-f", "concat", "-safe", "0"])
        .outputOptions([
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-r",
          String(fps),
        ])
        .output(slideshowPath)
        .on("end", () => resolve())
        .on("error", reject)
        .run();
    });

    onProgress(70);

    const outputPath = path.join(workDir, "output.mp4");
    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(slideshowPath)
        .input(audioPath)
        .outputOptions([
          "-c:v",
          "libx264",
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          "-shortest",
          "-pix_fmt",
          "yuv420p",
          "-movflags",
          "+faststart",
        ])
        .output(outputPath)
        .on("end", () => resolve())
        .on("error", reject)
        .run();
    });

    onProgress(85);
    return await uploadResultV1(
      manifest,
      workDir,
      outputPath,
      audioDuration,
      onProgress
    );
  } finally {
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
  const zoomRate = 0.0015;
  return new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(imagePath)
      .inputOptions(["-loop", "1"])
      .outputOptions([
        "-vf",
        `scale=${resolution.width * 2}:${resolution.height * 2},zoompan=z='min(zoom+${zoomRate},1.1)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${Math.ceil(duration * fps)}:s=${resolution.width}x${resolution.height}:fps=${fps}`,
        "-c:v",
        "libx264",
        "-t",
        String(duration),
        "-pix_fmt",
        "yuv420p",
      ])
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", reject)
      .run();
  });
}

async function uploadResultV1(
  manifest: AssemblyManifest,
  _workDir: string,
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

  const { data } = sb.storage
    .from("project-assets")
    .getPublicUrl(storagePath);

  onProgress(100);

  return {
    outputUrl: data.publicUrl,
    durationSeconds: Math.round(audioDuration),
    fileSizeBytes,
  };
}

// ═══════════════════════════════════════════════════════════════
// V2 Timeline-Driven Compositor
// ═══════════════════════════════════════════════════════════════

/**
 * Maximum number of scene clips to prepare in parallel.
 */
const PARALLEL_CLIP_LIMIT = 3;

/**
 * Download a file, returning "" on failure instead of throwing.
 */
async function safeDownload(
  url: string | undefined,
  destPath: string,
  label: string
): Promise<string> {
  if (!url) return "";
  try {
    await downloadFileRetry(url, destPath);
    return destPath;
  } catch (err) {
    console.warn(`[v2] Failed to download ${label}: ${url} — ${err}`);
    return "";
  }
}

/**
 * Process a batch of promises with concurrency limit.
 */
async function parallelLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number
): Promise<T[]> {
  const results: T[] = [];
  let idx = 0;

  async function next(): Promise<void> {
    while (idx < tasks.length) {
      const current = idx++;
      results[current] = await tasks[current]();
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () =>
    next()
  );
  await Promise.all(workers);
  return results;
}

export async function assembleVideoV2(
  manifest: AssemblyManifestV2,
  onProgress: (pct: number) => void
): Promise<AssemblyResultV2> {
  const jobId = uuid();
  const workDir = await ensureWorkDir(jobId);
  const clipsDir = path.join(workDir, "clips");
  await fs.mkdir(clipsDir, { recursive: true });

  const { fps, crf, preset } = manifest.output;
  const landscape = manifest.output.landscape;
  const portrait = manifest.output.portrait;

  try {
    // ── Phase 1: Download all assets (0-30%) ──
    console.log(`[v2] Job ${jobId}: downloading assets...`);
    onProgress(5);

    // Download voiceover
    const voiceoverPath = path.join(workDir, "voiceover.mp3");
    await downloadFileRetry(manifest.voiceover.url, voiceoverPath);
    const audioDuration = await getAudioDuration(voiceoverPath);
    onProgress(10);

    // Download brand intro assets
    const brandLogoPath = path.join(workDir, "brand_logo.png");
    const brandMusicPath = path.join(workDir, "brand_music.mp3");
    let hasBrandLogo = false;
    let hasBrandMusic = false;

    if (manifest.brandIntro) {
      const logoResult = await safeDownload(
        manifest.brandIntro.logoUrl,
        brandLogoPath,
        "brand logo"
      );
      hasBrandLogo = logoResult !== "";

      const musicResult = await safeDownload(
        manifest.brandIntro.musicUrl,
        brandMusicPath,
        "brand music"
      );
      hasBrandMusic = musicResult !== "";
    }
    onProgress(15);

    // Download scene assets in parallel
    const downloadTasks: (() => Promise<void>)[] = [];
    const assetPaths = new Map<number, string>(); // sceneIndex -> local path

    for (const scene of manifest.scenes) {
      const idx = scene.sceneIndex;
      downloadTasks.push(async () => {
        let url: string | undefined;
        let ext = "png";

        switch (scene.type) {
          case "DALLE":
            url = scene.imageUrl;
            ext = url?.includes(".jpg") ? "jpg" : "png";
            break;
          case "STOCK":
            url = scene.videoUrl;
            ext = "mp4";
            break;
          case "RUNWAY":
            url = scene.videoUrl;
            ext = "mp4";
            break;
          case "MOTION_GRAPHIC":
            url = scene.imageUrl;
            ext = "png";
            break;
        }

        const destPath = path.join(workDir, `asset-${idx}.${ext}`);
        const result = await safeDownload(url, destPath, `scene ${idx}`);
        if (result) assetPaths.set(idx, result);
      });
    }

    await parallelLimit(downloadTasks, 5);
    onProgress(30);

    // ── Phase 2: Prepare clips (30-60%) ──
    console.log(`[v2] Job ${jobId}: preparing clips...`);

    // 2a. Brand intro clip (mandatory scene 0)
    const brandIntroDuration = manifest.brandIntro?.duration || 8;
    const brandIntroClipPath = path.join(clipsDir, "clip-000-brand.mp4");

    if (hasBrandLogo) {
      await prepareMotionGraphicScene(
        brandLogoPath,
        brandIntroClipPath,
        brandIntroDuration,
        landscape,
        fps,
        preset,
        crf
      );
    } else {
      await prepareEndCard(
        brandIntroClipPath,
        brandIntroDuration,
        landscape,
        fps,
        preset,
        crf
      );
    }
    onProgress(35);

    // 2b. Build combined audio: brand music (8s) + voiceover
    const combinedAudioPath = path.join(workDir, "combined_audio.mp3");

    if (hasBrandMusic) {
      await buildCombinedAudio(
        brandMusicPath,
        voiceoverPath,
        combinedAudioPath
      );
    } else {
      // No brand music — create 8s of silence + voiceover
      const silencePath = path.join(workDir, "silence.mp3");
      const { execFile: execFileSync } = await import("child_process");
      const { promisify } = await import("util");
      const exec = promisify(execFileSync);
      await exec("ffmpeg", [
        "-y",
        "-f", "lavfi",
        "-i", `anullsrc=r=44100:cl=stereo`,
        "-t", String(brandIntroDuration),
        "-c:a", "aac",
        "-b:a", "192k",
        silencePath,
      ]);
      await buildCombinedAudio(silencePath, voiceoverPath, combinedAudioPath);
    }
    onProgress(40);

    // 2c. Prepare scene clips
    const clipPaths: { path: string; duration: number; transitionOut: string }[] = [];

    // Brand intro is always the first clip
    clipPaths.push({
      path: brandIntroClipPath,
      duration: brandIntroDuration,
      transitionOut: "fade",
    });

    const sceneTasks: (() => Promise<void>)[] = [];

    for (const scene of manifest.scenes) {
      const idx = scene.sceneIndex;
      const clipPath = path.join(clipsDir, `clip-${String(idx).padStart(3, "0")}.mp4`);
      const duration = scene.endTime - scene.startTime;
      const assetPath = assetPaths.get(idx);

      sceneTasks.push(async () => {
        try {
          if (!assetPath) {
            // No asset — black fallback
            console.warn(`[v2] Scene ${idx}: no asset, using black fallback`);
            await prepareEndCard(clipPath, duration, landscape, fps, preset, crf);
          } else {
            switch (scene.type) {
              case "DALLE":
                await prepareDalleScene(
                  assetPath,
                  clipPath,
                  duration,
                  landscape,
                  fps,
                  scene.kenBurnsVariant,
                  preset,
                  crf
                );
                break;

              case "STOCK":
              case "RUNWAY":
                await prepareVideoScene(
                  assetPath,
                  clipPath,
                  duration,
                  landscape,
                  fps,
                  preset,
                  crf
                );
                break;

              case "MOTION_GRAPHIC":
                await prepareMotionGraphicScene(
                  assetPath,
                  clipPath,
                  duration,
                  landscape,
                  fps,
                  preset,
                  crf
                );
                break;
            }
          }
        } catch (err) {
          console.error(`[v2] Scene ${idx} clip failed, using black fallback:`, err);
          await prepareEndCard(clipPath, duration, landscape, fps, preset, crf);
        }

        clipPaths.push({
          path: clipPath,
          duration,
          transitionOut: scene.transitionOut || "fade",
        });
      });
    }

    // Process clips with concurrency limit
    await parallelLimit(sceneTasks, PARALLEL_CLIP_LIMIT);

    // Sort clipPaths by filename to maintain scene order
    // (brand intro is already first, scene clips follow by padded index)
    clipPaths.sort((a, b) => a.path.localeCompare(b.path));

    onProgress(60);

    // ── Phase 3: Final composite (60-80%) ──
    console.log(`[v2] Job ${jobId}: compositing ${clipPaths.length} clips...`);

    // Parse lower thirds
    const lowerThirds: LowerThird[] =
      manifest.motionGraphics?.lowerThirds || [];

    const landscapePath = path.join(workDir, "output_landscape.mp4");
    const ffmpegArgs = buildFfmpegArgs(
      clipPaths.map((c) => ({
        path: c.path,
        duration: c.duration,
        transitionOut: (c.transitionOut as "fade" | "dissolve" | "cut") || "fade",
      })),
      combinedAudioPath,
      lowerThirds,
      landscapePath,
      fps
    );

    // Execute the composite command
    const { execFile: execFileComposite } = await import("child_process");
    const { promisify: promisifyComposite } = await import("util");
    const execComposite = promisifyComposite(execFileComposite);

    await execComposite("ffmpeg", ["-y", ...ffmpegArgs], {
      maxBuffer: 50 * 1024 * 1024,
    });

    onProgress(80);

    // ── Phase 4: Portrait version (80-90%) ──
    console.log(`[v2] Job ${jobId}: creating portrait version...`);

    const portraitPath = path.join(workDir, "output_portrait.mp4");
    await createPortraitVersion(landscapePath, portraitPath, portrait, preset, crf);

    onProgress(90);

    // ── Phase 5: Upload both to Supabase (90-100%) ──
    console.log(`[v2] Job ${jobId}: uploading...`);

    const totalAudioDuration =
      brandIntroDuration + audioDuration;

    const result = await uploadResultV2(
      manifest,
      landscapePath,
      portraitPath,
      totalAudioDuration,
      onProgress
    );

    console.log(`[v2] Job ${jobId}: complete!`);
    return result;
  } finally {
    try {
      await fs.rm(workDir, { recursive: true, force: true });
    } catch {}
  }
}

async function uploadResultV2(
  manifest: AssemblyManifestV2,
  landscapePath: string,
  portraitPath: string,
  audioDuration: number,
  onProgress: (pct: number) => void
): Promise<AssemblyResultV2> {
  const sb = createClient(manifest.supabaseUrl, manifest.supabaseKey);
  const bucket = "project-assets";

  // Upload landscape
  const landscapeBuffer = await fs.readFile(landscapePath);
  const landscapeStoragePath = `${manifest.projectId}/final-video.mp4`;

  const { error: lErr } = await sb.storage
    .from(bucket)
    .upload(landscapeStoragePath, landscapeBuffer, {
      contentType: "video/mp4",
      upsert: true,
    });
  if (lErr) throw new Error(`Landscape upload failed: ${lErr.message}`);

  const { data: lData } = sb.storage
    .from(bucket)
    .getPublicUrl(landscapeStoragePath);

  onProgress(95);

  // Upload portrait
  const portraitBuffer = await fs.readFile(portraitPath);
  const portraitStoragePath = `${manifest.projectId}/final-video-portrait.mp4`;

  const { error: pErr } = await sb.storage
    .from(bucket)
    .upload(portraitStoragePath, portraitBuffer, {
      contentType: "video/mp4",
      upsert: true,
    });
  if (pErr) throw new Error(`Portrait upload failed: ${pErr.message}`);

  const { data: pData } = sb.storage
    .from(bucket)
    .getPublicUrl(portraitStoragePath);

  onProgress(100);

  return {
    landscapeUrl: lData.publicUrl,
    portraitUrl: pData.publicUrl,
    durationSeconds: Math.round(audioDuration),
    fileSizeBytes: landscapeBuffer.length + portraitBuffer.length,
  };
}
