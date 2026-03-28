import ffmpeg from "fluent-ffmpeg";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

interface SilenceInterval {
  start: number;
  end: number;
  duration: number;
}

interface TimingScene {
  scene: number;
  tag_type: string;
  duration: number;
  label: string;
  start_time_seconds: number;
  end_time_seconds: number;
  transition_in: string;
  transition_out: string;
  visual_asset_id: string;
}

/**
 * Detect silence intervals in an audio file using ffmpeg silencedetect.
 * Tuned for ElevenLabs TTS output: -45dB threshold, 0.2s minimum duration.
 */
export async function detectSilence(
  audioPath: string,
  noiseThresholdDb: number = -45,
  minDuration: number = 0.2
): Promise<SilenceInterval[]> {
  return new Promise((resolve, reject) => {
    const silences: SilenceInterval[] = [];
    let currentStart: number | null = null;

    ffmpeg(audioPath)
      .audioFilters(`silencedetect=noise=${noiseThresholdDb}dB:d=${minDuration}`)
      .format("null")
      .output("/dev/null")
      .on("stderr", (line: string) => {
        // Parse silence_start
        const startMatch = line.match(/silence_start:\s*([\d.]+)/);
        if (startMatch) {
          currentStart = parseFloat(startMatch[1]);
        }
        // Parse silence_end
        const endMatch = line.match(/silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/);
        if (endMatch && currentStart !== null) {
          silences.push({
            start: currentStart,
            end: parseFloat(endMatch[1]),
            duration: parseFloat(endMatch[2]),
          });
          currentStart = null;
        }
      })
      .on("end", () => resolve(silences))
      .on("error", (err: Error) => reject(err))
      .run();
  });
}

/**
 * Get audio duration using ffprobe.
 */
export async function getAudioDuration(audioPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(audioPath, (err, metadata) => {
      if (err) return reject(err);
      resolve(metadata.format.duration || 0);
    });
  });
}

/**
 * Build timing data from an audio file and scene count.
 * Uses silence detection to find natural speech pauses and map them to scene boundaries.
 * Falls back to even distribution if silence detection produces too few boundaries.
 */
export async function buildTimingFromAudio(
  audioPath: string,
  sceneCount: number,
  sceneLabels?: { tag_type: string; label: string; visual_asset_id: string }[]
): Promise<{ timing: TimingScene[]; audioDuration: number }> {
  const audioDuration = await getAudioDuration(audioPath);
  const silences = await detectSilence(audioPath, -45, 0.2);

  console.log(`[timing] Audio duration: ${audioDuration.toFixed(1)}s, silences found: ${silences.length}`);

  let boundaries: number[] = [];

  if (silences.length >= sceneCount - 1) {
    // Enough silences — pick the strongest (longest) ones as scene boundaries
    const sorted = [...silences].sort((a, b) => b.duration - a.duration);
    const selected = sorted.slice(0, sceneCount - 1).sort((a, b) => a.start - b.start);
    boundaries = selected.map(s => s.start + s.duration / 2); // mid-point of silence
  } else if (silences.length > 0) {
    // Some silences found — use all of them and fill gaps with even splits
    boundaries = silences.map(s => s.start + s.duration / 2);
    // Add evenly-spaced boundaries for remaining scenes
    const remaining = sceneCount - 1 - boundaries.length;
    if (remaining > 0) {
      const interval = audioDuration / (remaining + 1);
      for (let i = 1; i <= remaining; i++) {
        const candidate = i * interval;
        // Only add if not too close to an existing boundary
        if (!boundaries.some(b => Math.abs(b - candidate) < 2)) {
          boundaries.push(candidate);
        }
      }
      boundaries.sort((a, b) => a - b);
    }
  } else {
    // No silences detected — fall back to even distribution
    console.warn("[timing] No silences detected, using even distribution");
    for (let i = 1; i < sceneCount; i++) {
      boundaries.push((i / sceneCount) * audioDuration);
    }
  }

  // Ensure we have exactly sceneCount - 1 boundaries
  boundaries = boundaries.slice(0, sceneCount - 1);

  // Build timing scenes from boundaries
  const timing: TimingScene[] = [];
  const starts = [0, ...boundaries];
  const ends = [...boundaries, audioDuration];

  for (let i = 0; i < sceneCount; i++) {
    const startTime = Math.round(starts[i] * 100) / 100;
    const endTime = Math.round((ends[i] ?? audioDuration) * 100) / 100;
    const duration = Math.round((endTime - startTime) * 100) / 100;
    const meta = sceneLabels?.[i];

    timing.push({
      scene: i + 1,
      tag_type: meta?.tag_type || "DALLE",
      duration,
      label: meta?.label || `Scene ${i + 1}`,
      start_time_seconds: startTime,
      end_time_seconds: endTime,
      transition_in: i === 0 ? "fade" : "cut",
      transition_out: i === sceneCount - 1 ? "fade" : "cut",
      visual_asset_id: meta?.visual_asset_id || `DALLE_${String(i + 1).padStart(3, "0")}`,
    });
  }

  return { timing, audioDuration };
}

/**
 * Download audio from URL to a temp file, run timing analysis, clean up.
 */
export async function timingFromAudioUrl(
  audioUrl: string,
  sceneCount: number,
  sceneLabels?: { tag_type: string; label: string; visual_asset_id: string }[]
): Promise<{ timing: TimingScene[]; audioDuration: number }> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "timing-"));
  const tmpPath = path.join(tmpDir, "voiceover.mp3");

  try {
    // Download audio
    const res = await fetch(audioUrl);
    if (!res.ok) throw new Error(`Failed to download audio: ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    await fs.writeFile(tmpPath, buffer);

    return await buildTimingFromAudio(tmpPath, sceneCount, sceneLabels);
  } finally {
    try {
      await fs.rm(tmpDir, { recursive: true });
    } catch {}
  }
}
