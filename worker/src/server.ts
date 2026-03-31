import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { assembleVideo, assembleVideoV2 } from "./assembler";
import { timingFromAudioUrl } from "./timing-from-audio";
import { renderMotionGraphic, renderMotionGraphicFromSpec } from "./motion-graphic-renderer";
import { uploadToR2 } from "./r2-upload";
import { v4 as uuid } from "uuid";
import * as path from "path";
import * as os from "os";
import * as fs from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const app = express();
app.use(express.json({ limit: "10mb" }));

// Job tracking
interface Job {
  id: string;
  projectId: string;
  status: "queued" | "downloading" | "rendering" | "uploading" | "completed" | "failed";
  progress: number;
  outputUrl?: string;
  portraitUrl?: string;
  error?: string;
  startedAt: string;
  completedAt?: string;
}

const jobs = new Map<string, Job>();

// Auth middleware
const authMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const secret = process.env.WORKER_SECRET;
  if (!secret) return next(); // skip auth in dev
  const auth = req.headers.authorization;
  if (auth !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
};

// Health check (unauthenticated)
app.get("/health", (_req, res) => {
  res.json({ status: "ok", jobs: jobs.size });
});

// Apply auth to protected routes
app.use("/assemble", authMiddleware);
app.use("/llm", authMiddleware);
app.use("/generate-images", authMiddleware);
app.use("/generate-voiceover", authMiddleware);
app.use("/timing-from-audio", authMiddleware);
app.use("/render-motion-graphic", authMiddleware);
app.use("/status", authMiddleware);

// ── Long-running LLM endpoint (no timeout) ──

app.post("/llm", async (req, res) => {
  const { step, projectId, system, prompt, maxTokens, model, callbackUrl } = req.body;

  if (!projectId || !system || !prompt) {
    return res.status(400).json({ error: "Missing required fields: projectId, system, prompt" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured on worker" });
  }

  const jobId = uuid();
  const job: Job = {
    id: jobId,
    projectId,
    status: "queued",
    progress: 0,
    startedAt: new Date().toISOString(),
  };
  jobs.set(jobId, job);

  const llmModel = model || "claude-sonnet-4-6";
  console.log(`LLM Job ${jobId}: step=${step} model=${llmModel} maxTokens=${maxTokens || 16384}`);

  // Run LLM call asynchronously
  (async () => {
    try {
      job.status = "rendering"; // reuse status for "generating"
      job.progress = 10;

      const client = new Anthropic({ apiKey });
      // Use streaming to avoid SDK 10-minute timeout on large maxTokens
      const stream = await client.messages.stream({
        model: llmModel,
        max_tokens: maxTokens || 16384,
        system,
        messages: [{ role: "user", content: prompt }],
      });
      const message = await stream.finalMessage();

      const text = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");

      const inputTokens = message.usage.input_tokens;
      const outputTokens = message.usage.output_tokens;

      job.status = "completed";
      job.progress = 100;
      job.completedAt = new Date().toISOString();

      console.log(`LLM Job ${jobId}: completed — ${outputTokens} output tokens, ${text.length} chars`);

      if (callbackUrl) {
        console.log(`LLM Job ${jobId}: sending callback to ${callbackUrl}`);
        try {
          const cbRes = await fetch(callbackUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jobId,
              step,
              projectId,
              status: "completed",
              text,
              inputTokens,
              outputTokens,
              model: llmModel,
            }),
          });
          if (!cbRes.ok) {
            console.error(`LLM Job ${jobId}: callback returned ${cbRes.status} ${cbRes.statusText}`);
          } else {
            console.log(`LLM Job ${jobId}: callback success`);
          }
        } catch (err) {
          console.error(`LLM Job ${jobId}: callback failed:`, err);
        }
      }
    } catch (err) {
      job.status = "failed";
      job.error = String(err);
      job.completedAt = new Date().toISOString();
      console.error(`LLM Job ${jobId} failed:`, err);

      if (callbackUrl) {
        try {
          await fetch(callbackUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jobId,
              step,
              projectId,
              status: "failed",
              error: String(err),
            }),
          });
        } catch {}
      }
    }
  })();

  res.json({ jobId, status: "queued" });
});

// Start assembly job
app.post("/assemble", async (req, res) => {
  const { manifest, callbackUrl } = req.body;

  if (!manifest?.projectId) {
    return res.status(400).json({ error: "Missing manifest.projectId" });
  }

  const jobId = uuid();
  const job: Job = {
    id: jobId,
    projectId: manifest.projectId,
    status: "queued",
    progress: 0,
    startedAt: new Date().toISOString(),
  };
  jobs.set(jobId, job);

  // Start assembly in background
  const isV2 = manifest.version === 2;
  console.log(`Job ${jobId}: starting ${isV2 ? "v2 timeline" : "v1 legacy"} assembly`);

  (async () => {
    try {
      job.status = "downloading";
      job.progress = 5;

      const onProgress = (progress: number) => {
        job.progress = progress;
        if (progress < 30) job.status = "downloading";
        else if (progress < 90) job.status = "rendering";
        else job.status = "uploading";
      };

      if (isV2) {
        const result = await assembleVideoV2(manifest, onProgress);

        job.status = "completed";
        job.progress = 100;
        job.outputUrl = result.landscapeUrl;
        job.portraitUrl = result.portraitUrl;
        job.completedAt = new Date().toISOString();

        if (callbackUrl) {
          console.log(`Job ${jobId}: sending callback to ${callbackUrl}`);
          try {
            const cbRes = await fetch(callbackUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                jobId,
                projectId: manifest.projectId,
                status: "completed",
                outputUrl: result.landscapeUrl,
                portraitUrl: result.portraitUrl,
                durationSeconds: result.durationSeconds,
                fileSizeBytes: result.fileSizeBytes,
              }),
            });
            if (!cbRes.ok) {
              console.error(`Job ${jobId}: callback returned ${cbRes.status} ${cbRes.statusText} — output URLs: landscape=${result.landscapeUrl} portrait=${result.portraitUrl}`);
            } else {
              console.log(`Job ${jobId}: callback success`);
            }
          } catch (err) {
            console.error(`Job ${jobId}: callback failed (${callbackUrl}):`, err, `— output URLs: landscape=${result.landscapeUrl} portrait=${result.portraitUrl}`);
          }
        } else {
          console.warn(`Job ${jobId}: no callbackUrl — output URLs: landscape=${result.landscapeUrl} portrait=${result.portraitUrl}`);
        }
      } else {
        const result = await assembleVideo(manifest, onProgress);

        job.status = "completed";
        job.progress = 100;
        job.outputUrl = result.outputUrl;
        job.completedAt = new Date().toISOString();

        if (callbackUrl) {
          console.log(`Job ${jobId}: sending V1 callback to ${callbackUrl}`);
          try {
            const cbRes = await fetch(callbackUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                jobId,
                projectId: manifest.projectId,
                status: "completed",
                outputUrl: result.outputUrl,
                durationSeconds: result.durationSeconds,
                fileSizeBytes: result.fileSizeBytes,
              }),
            });
            if (!cbRes.ok) {
              console.error(`Job ${jobId}: V1 callback returned ${cbRes.status} — outputUrl=${result.outputUrl}`);
            }
          } catch (err) {
            console.error(`Job ${jobId}: V1 callback failed (${callbackUrl}):`, err, `— outputUrl=${result.outputUrl}`);
          }
        }
      }
    } catch (err) {
      job.status = "failed";
      job.error = String(err);
      job.completedAt = new Date().toISOString();
      console.error(`Job ${jobId} failed:`, err);

      if (callbackUrl) {
        try {
          await fetch(callbackUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jobId,
              projectId: manifest.projectId,
              status: "failed",
              error: String(err),
            }),
          });
        } catch {}
      }
    }
  })();

  res.json({ jobId, status: "queued" });
});

// ── Generate DALL-E images in parallel batches → R2 ──

app.post("/generate-images", async (req, res) => {
  const { projectId, step: stepName, scenes, allScenes, prompts, imageSize, callbackUrl } = req.body;

  // Accept scenes[] (new) or prompts[] (legacy)
  interface SceneInput { scene_id: number; label: string; prompt: string; image_url?: string | null; revised_prompt?: string | null; status?: string; error?: string; ken_burns?: string }
  const pendingScenes: SceneInput[] = scenes || (prompts || []).map((p: string, i: number) => ({
    scene_id: i + 1, label: "", prompt: p, image_url: null, revised_prompt: null, status: "pending",
  }));
  const fullScenes: SceneInput[] = allScenes || pendingScenes;

  if (!projectId || pendingScenes.length === 0) {
    return res.status(400).json({ error: "Missing projectId or scenes/prompts" });
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    return res.status(500).json({ error: "OPENAI_API_KEY not configured on worker" });
  }

  const jobId = uuid();
  console.log(`[images] Job ${jobId}: ${pendingScenes.length} pending DALL-E scenes for project ${projectId}`);
  res.json({ jobId, status: "queued" });

  // Run async
  (async () => {
    try {
      const batchSize = 5;
      const maxScenes = Math.min(pendingScenes.length, 15);
      const resultMap = new Map<number, SceneInput>();

      // Generate in parallel batches
      for (let batch = 0; batch < maxScenes; batch += batchSize) {
        const batchScenes = pendingScenes.slice(batch, batch + batchSize);
        console.log(`[images] Job ${jobId}: batch ${Math.floor(batch / batchSize) + 1} — ${batchScenes.length} images`);

        const results = await Promise.all(
          batchScenes.map(async (scene) => {
            try {
              const dalleRes = await fetch("https://api.openai.com/v1/images/generations", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${openaiKey}`,
                },
                body: JSON.stringify({
                  model: "dall-e-3",
                  prompt: scene.prompt,
                  n: 1,
                  size: imageSize || "1792x1024",
                  quality: "hd",
                }),
              });

              if (!dalleRes.ok) {
                const errBody = await dalleRes.json().catch(() => ({ error: {} })) as { error?: { code?: string; message?: string } };
                const isContentPolicy = errBody?.error?.code === "content_policy_violation";
                const errMsg = errBody?.error?.message || "DALL-E generation failed";
                console.error(`[images] Job ${jobId}: scene ${scene.scene_id} ${isContentPolicy ? "rejected" : "failed"}: ${errMsg.slice(0, 200)}`);
                return { ...scene, status: isContentPolicy ? "rejected" : "failed", error: errMsg, image_url: null };
              }

              const dalleData = await dalleRes.json() as { data: { url: string; revised_prompt: string }[] };
              const imgUrl = dalleData.data[0]?.url;
              const revisedPrompt = dalleData.data[0]?.revised_prompt || "";
              if (!imgUrl) return { ...scene, status: "failed", error: "No image URL in response", image_url: null };

              // Download and upload to R2
              const imgRes = await fetch(imgUrl);
              if (!imgRes.ok) return { ...scene, status: "failed", error: "Failed to download image", image_url: null };
              const imgBuffer = Buffer.from(await imgRes.arrayBuffer());

              const tmpPath = path.join(os.tmpdir(), `dalle-${jobId}-${scene.scene_id}.png`);
              await fs.writeFile(tmpPath, imgBuffer);

              const r2Key = `images/${projectId}/dalle-scene-${String(scene.scene_id).padStart(3, "0")}.png`;
              const publicUrl = await uploadToR2(tmpPath, r2Key, "image/png");
              await fs.unlink(tmpPath).catch(() => {});

              return { ...scene, status: "completed", image_url: publicUrl, revised_prompt: revisedPrompt, error: undefined };
            } catch (err) {
              console.error(`[images] Job ${jobId}: scene ${scene.scene_id} failed:`, err);
              return { ...scene, status: "failed", error: String(err), image_url: null };
            }
          })
        );

        for (const r of results) resultMap.set(r.scene_id, r);
      }

      // Merge results into full scene list
      const mergedScenes = fullScenes.map(s => resultMap.get(s.scene_id) || s);
      const completedCount = mergedScenes.filter(s => s.status === "completed" && s.image_url).length;

      // Build legacy images[] for backwards compat
      const images = mergedScenes
        .filter(s => s.status === "completed" && s.image_url)
        .map(s => ({ url: s.image_url!, prompt: s.prompt, revised_prompt: s.revised_prompt || "", stored: true }));

      console.log(`[images] Job ${jobId}: completed — ${completedCount}/${mergedScenes.length} scenes generated`);

      const callbackStep = stepName || "image_generation";
      if (callbackUrl) {
        try {
          await fetch(callbackUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId,
              step: callbackStep,
              status: "completed",
              output: {
                status: "completed",
                scenes: mergedScenes,
                images,
                total_prompts: mergedScenes.length,
                generated: completedCount,
              },
              cost_cents: completedCount * 8,
            }),
          });
        } catch (err) {
          console.error(`[images] Job ${jobId}: callback failed:`, err);
        }
      }
    } catch (err) {
      console.error(`[images] Job ${jobId} failed:`, err);
      const callbackStep = stepName || "image_generation";
      if (callbackUrl) {
        try {
          await fetch(callbackUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId,
              step: callbackStep,
              status: "failed",
              error: String(err),
            }),
          });
        } catch {}
      }
    }
  })();
});

// ── Generate voiceover via ElevenLabs → R2 ──

/**
 * Split text into chunks ≤maxChars on paragraph boundaries.
 * Prevents ElevenLabs 10,000-char limit errors on long scripts.
 */
function splitIntoChunks(text: string, maxChars = 9500): string[] {
  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let current = "";
  for (const para of paragraphs) {
    const candidate = current ? current + "\n\n" + para : para;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) chunks.push(current);
      // If a single paragraph exceeds maxChars, split on sentence boundaries
      if (para.length > maxChars) {
        const sentences = para.split(/(?<=[.!?])\s+/);
        let sentChunk = "";
        for (const s of sentences) {
          const sc = sentChunk ? sentChunk + " " + s : s;
          if (sc.length <= maxChars) { sentChunk = sc; }
          else { if (sentChunk) chunks.push(sentChunk); sentChunk = s; }
        }
        current = sentChunk;
      } else {
        current = para;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks.filter(Boolean);
}

/**
 * Call ElevenLabs TTS for a single text chunk, return MP3 Buffer.
 */
async function ttsChunk(
  text: string,
  voiceId: string,
  modelId: string,
  voiceSettings: Record<string, unknown>,
  elevenLabsKey: string
): Promise<Buffer> {
  const ttsRes = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
    {
      method: "POST",
      headers: {
        "xi-api-key": elevenLabsKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({ text, model_id: modelId, voice_settings: voiceSettings }),
    }
  );

  if (!ttsRes.ok) {
    const errText = await ttsRes.text();
    throw new Error(`ElevenLabs API error ${ttsRes.status}: ${errText.slice(0, 300)}`);
  }

  const parts: Buffer[] = [];
  const reader = ttsRes.body?.getReader();
  if (!reader) throw new Error("No response body from ElevenLabs");
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(Buffer.from(value));
  }
  return Buffer.concat(parts);
}

app.post("/generate-voiceover", async (req, res) => {
  const { projectId, text, voiceId, modelId, voiceSettings, elevenLabsKey, callbackUrl } = req.body;

  if (!projectId || !text || !voiceId || !elevenLabsKey) {
    return res.status(400).json({ error: "Missing projectId, text, voiceId, or elevenLabsKey" });
  }

  const jobId = uuid();
  const wordCount = text.split(/\s+/).length;
  const resolvedModel = modelId || "eleven_multilingual_v2";
  const resolvedVoiceSettings = voiceSettings || { stability: 0.5, similarity_boost: 0.75, style: 0.5, use_speaker_boost: true };

  console.log(`[voiceover] Job ${jobId}: ${wordCount} words (${text.length} chars), voice ${voiceId}`);
  res.json({ jobId, status: "queued" });

  (async () => {
    try {
      const textChunks = splitIntoChunks(text);
      console.log(`[voiceover] Job ${jobId}: ${textChunks.length} chunk(s) — sizes: ${textChunks.map(c => c.length).join(", ")} chars`);

      let audioBuffer: Buffer;
      let totalBytes: number;

      if (textChunks.length === 1) {
        // Single chunk — direct upload
        audioBuffer = await ttsChunk(text, voiceId, resolvedModel, resolvedVoiceSettings, elevenLabsKey);
        totalBytes = audioBuffer.length;
        console.log(`[voiceover] Job ${jobId}: single chunk, ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);

        const tmpPath = path.join(os.tmpdir(), `voiceover-${jobId}.mp3`);
        await fs.writeFile(tmpPath, audioBuffer);
        const r2Key = `audio/${projectId}/voiceover.mp3`;
        const audioUrl = await uploadToR2(tmpPath, r2Key, "audio/mpeg");
        await fs.unlink(tmpPath).catch(() => {});

        const estimatedDurationMin = Math.round(wordCount / 150 * 10) / 10;
        console.log(`[voiceover] Job ${jobId}: uploaded to ${audioUrl}`);

        if (callbackUrl) {
          await fetch(callbackUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId, step: "voiceover_generation", status: "completed",
              output: {
                status: "completed", voice_id: voiceId,
                narration_length: text.length, word_count: wordCount,
                estimated_duration_minutes: estimatedDurationMin,
                audio_confirmed: true, audio_url: audioUrl,
                audio_size_bytes: totalBytes,
                note: "Audio uploaded to R2 via worker.",
              },
              cost_cents: Math.ceil(text.length * 0.003),
            }),
          });
        }
      } else {
        // Multiple chunks — generate each, concat with ffmpeg
        const chunkPaths: string[] = [];
        let chunkTotalBytes = 0;

        for (let i = 0; i < textChunks.length; i++) {
          console.log(`[voiceover] Job ${jobId}: generating chunk ${i + 1}/${textChunks.length} (${textChunks[i].length} chars)`);
          const chunkBuf = await ttsChunk(textChunks[i], voiceId, resolvedModel, resolvedVoiceSettings, elevenLabsKey);
          chunkTotalBytes += chunkBuf.length;
          const chunkPath = path.join(os.tmpdir(), `voiceover-${jobId}-chunk${i}.mp3`);
          await fs.writeFile(chunkPath, chunkBuf);
          chunkPaths.push(chunkPath);
        }

        console.log(`[voiceover] Job ${jobId}: concatenating ${chunkPaths.length} chunks with ffmpeg`);

        // Write ffmpeg concat list
        const concatListPath = path.join(os.tmpdir(), `voiceover-${jobId}-concat.txt`);
        const concatContent = chunkPaths.map(p => `file '${p}'`).join("\n");
        await fs.writeFile(concatListPath, concatContent);

        const outputPath = path.join(os.tmpdir(), `voiceover-${jobId}.mp3`);
        await execFileAsync("ffmpeg", [
          "-y", "-f", "concat", "-safe", "0",
          "-i", concatListPath,
          "-c", "copy",
          outputPath,
        ]);

        // Cleanup chunk files and concat list
        await Promise.all([...chunkPaths, concatListPath].map(p => fs.unlink(p).catch(() => {})));

        totalBytes = chunkTotalBytes;
        const r2Key = `audio/${projectId}/voiceover.mp3`;
        const audioUrl = await uploadToR2(outputPath, r2Key, "audio/mpeg");
        await fs.unlink(outputPath).catch(() => {});

        const estimatedDurationMin = Math.round(wordCount / 150 * 10) / 10;
        console.log(`[voiceover] Job ${jobId}: ${textChunks.length}-chunk concat uploaded to ${audioUrl}`);

        if (callbackUrl) {
          await fetch(callbackUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId, step: "voiceover_generation", status: "completed",
              output: {
                status: "completed", voice_id: voiceId,
                narration_length: text.length, word_count: wordCount,
                estimated_duration_minutes: estimatedDurationMin,
                audio_confirmed: true, audio_url: audioUrl,
                audio_size_bytes: totalBytes,
                chunks_generated: textChunks.length,
                note: `Audio assembled from ${textChunks.length} chunks and uploaded to R2 via worker.`,
              },
              cost_cents: Math.ceil(text.length * 0.003),
            }),
          });
        }
      }
    } catch (err) {
      console.error(`[voiceover] Job ${jobId} failed:`, err);
      if (callbackUrl) {
        try {
          await fetch(callbackUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId, step: "voiceover_generation", status: "failed", error: String(err),
            }),
          });
        } catch {}
      }
    }
  })();
});

// ── Generate hero scenes via Runway text-to-video → R2 ──

app.use("/generate-hero-scenes", authMiddleware);

app.post("/generate-hero-scenes", async (req, res) => {
  const { projectId, scenes, allScenes, runwayKey, callbackUrl } = req.body;

  // Accept new format (scene_id/prompt) or legacy (section/promptText)
  interface SceneInput { scene_id: number; label: string; prompt: string; video_url?: string | null; task_id?: string | null; status?: string; error?: string; motion_type?: string }
  const pendingScenes: SceneInput[] = (scenes || []).map((s: Record<string, unknown>) => ({
    scene_id: s.scene_id ?? 0,
    label: s.label || s.section || "",
    prompt: s.prompt || s.promptText || "",
    video_url: null, task_id: null, status: "pending",
    motion_type: s.motion_type || undefined,
  }));
  const fullScenes: SceneInput[] = allScenes ? (allScenes as SceneInput[]) : pendingScenes;

  if (!projectId || pendingScenes.length === 0 || !runwayKey) {
    return res.status(400).json({ error: "Missing projectId, scenes, or runwayKey" });
  }

  const jobId = uuid();
  console.log(`[hero] Job ${jobId}: ${pendingScenes.length} pending Runway scenes for project ${projectId}`);
  res.json({ jobId, status: "queued" });

  (async () => {
    try {
      const RUNWAY_API = "https://api.dev.runwayml.com/v1";
      const resultMap = new Map<number, SceneInput>();

      // Submit all pending scenes in parallel
      const tasks = await Promise.all(
        pendingScenes.slice(0, 5).map(async (scene) => {
          try {
            const submitRes = await fetch(`${RUNWAY_API}/text_to_video`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${runwayKey}`,
                "X-Runway-Version": "2024-11-06",
              },
              body: JSON.stringify({
                model: "gen4.5",
                promptText: scene.prompt.slice(0, 1000),
                duration: 5,
                ratio: "1280:720",
              }),
            });

            if (!submitRes.ok) {
              const errBody = await submitRes.json().catch(() => ({ error: {} })) as { error?: { code?: string; message?: string } };
              const errMsg = errBody?.error?.message || "Runway submission failed";
              const isContentPolicy = errMsg.toLowerCase().includes("content") && errMsg.toLowerCase().includes("policy");
              console.error(`[hero] Job ${jobId}: scene ${scene.scene_id} ${isContentPolicy ? "rejected" : "failed"}: ${errMsg.slice(0, 200)}`);
              resultMap.set(scene.scene_id, { ...scene, status: isContentPolicy ? "rejected" : "failed", error: errMsg });
              return null;
            }

            const { id: taskId } = await submitRes.json() as { id: string };
            console.log(`[hero] Job ${jobId}: submitted scene ${scene.scene_id} "${scene.label}" → task ${taskId}`);
            return { ...scene, task_id: taskId, status: "submitted" };
          } catch (err) {
            console.error(`[hero] Job ${jobId}: submit error for scene ${scene.scene_id}:`, err);
            resultMap.set(scene.scene_id, { ...scene, status: "failed", error: String(err) });
            return null;
          }
        })
      );

      const activeTasks = tasks.filter(Boolean) as SceneInput[];
      console.log(`[hero] Job ${jobId}: ${activeTasks.length}/${pendingScenes.length} tasks submitted, polling...`);

      // Poll all tasks until done (max 5 min)
      const MAX_POLL = 60;
      const pending = new Set(activeTasks.map(t => t.task_id!));

      for (let poll = 0; poll < MAX_POLL && pending.size > 0; poll++) {
        await new Promise(r => setTimeout(r, 5000));

        for (const task of activeTasks) {
          if (!task.task_id || !pending.has(task.task_id)) continue;

          try {
            const statusRes = await fetch(`${RUNWAY_API}/tasks/${task.task_id}`, {
              headers: { Authorization: `Bearer ${runwayKey}`, "X-Runway-Version": "2024-11-06" },
            });
            if (!statusRes.ok) continue;
            const status = await statusRes.json() as { status: string; output?: string[]; failure?: string };

            if (status.status === "SUCCEEDED" && status.output?.[0]) {
              pending.delete(task.task_id!);
              const videoUrl = status.output[0];

              try {
                const vidRes = await fetch(videoUrl);
                if (vidRes.ok) {
                  const vidBuffer = Buffer.from(await vidRes.arrayBuffer());
                  const tmpPath = path.join(os.tmpdir(), `runway-${jobId}-${task.scene_id}.mp4`);
                  await fs.writeFile(tmpPath, vidBuffer);
                  const r2Key = `runway/${projectId}/scene-${String(task.scene_id).padStart(3, "0")}.mp4`;
                  const publicUrl = await uploadToR2(tmpPath, r2Key, "video/mp4");
                  await fs.unlink(tmpPath).catch(() => {});
                  resultMap.set(task.scene_id, { ...task, status: "completed", video_url: publicUrl, error: undefined });
                  console.log(`[hero] Job ${jobId}: scene ${task.scene_id} completed → ${publicUrl}`);
                }
              } catch (err) {
                console.error(`[hero] Job ${jobId}: download/upload failed for scene ${task.scene_id}:`, err);
                resultMap.set(task.scene_id, { ...task, status: "completed", video_url: videoUrl, error: undefined });
              }
            } else if (status.status === "FAILED") {
              pending.delete(task.task_id!);
              console.error(`[hero] Job ${jobId}: scene ${task.scene_id} failed: ${status.failure}`);
              resultMap.set(task.scene_id, { ...task, status: "failed", error: status.failure || "Runway generation failed" });
            }
          } catch {}
        }
      }

      if (pending.size > 0) {
        console.warn(`[hero] Job ${jobId}: ${pending.size} tasks timed out after 5 min`);
        for (const task of activeTasks) {
          if (task.task_id && pending.has(task.task_id)) {
            resultMap.set(task.scene_id, { ...task, status: "failed", error: "Timed out after 5 minutes" });
          }
        }
      }

      // Merge results into full scene list
      const mergedScenes = fullScenes.map(s => resultMap.get(s.scene_id) || s);
      const completedCount = mergedScenes.filter(s => s.status === "completed" && s.video_url).length;

      console.log(`[hero] Job ${jobId}: completed — ${completedCount}/${mergedScenes.length} scenes`);

      if (callbackUrl) {
        try {
          await fetch(callbackUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId,
              step: "hero_scenes",
              status: "completed",
              output: {
                scenes: mergedScenes,
                status: "completed",
                tasks_started: activeTasks.length,
                total_requested: mergedScenes.length,
              },
              cost_cents: completedCount * 5,
            }),
          });
        } catch (err) {
          console.error(`[hero] Job ${jobId}: callback failed:`, err);
        }
      }
    } catch (err) {
      console.error(`[hero] Job ${jobId} failed:`, err);
      if (callbackUrl) {
        try {
          await fetch(callbackUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId, step: "hero_scenes", status: "failed", error: String(err) }),
          });
        } catch {}
      }
    }
  })();
});

// ── Timing from audio — detect speech pauses and build scene timing ──

app.post("/timing-from-audio", async (req, res) => {
  try {
    const { audioUrl, sceneCount, sceneLabels, callbackUrl, projectId, step } = req.body;

    if (!audioUrl || !sceneCount) {
      return res.status(400).json({ error: "Missing audioUrl or sceneCount" });
    }

    const jobId = uuid();
    console.log(`[timing] Job ${jobId}: ${sceneCount} scenes from ${audioUrl.slice(0, 80)}...`);

    // Run async — callback when done
    (async () => {
      try {
        const result = await timingFromAudioUrl(audioUrl, sceneCount, sceneLabels);
        console.log(`[timing] Job ${jobId}: completed — ${result.timing.length} scenes, ${result.audioDuration.toFixed(1)}s audio`);

        if (callbackUrl) {
          try {
            const cbRes = await fetch(callbackUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                jobId,
                projectId,
                step,
                status: "completed",
                output: { timing: result.timing, audioDuration: result.audioDuration },
              }),
            });
            if (!cbRes.ok) {
              console.error(`[timing] Job ${jobId}: callback returned ${cbRes.status}`);
            }
          } catch (err) {
            console.error(`[timing] Job ${jobId}: callback failed:`, err);
          }
        }
      } catch (err) {
        console.error(`[timing] Job ${jobId} failed:`, err);
        if (callbackUrl) {
          try {
            await fetch(callbackUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ jobId, projectId, step, status: "failed", error: String(err) }),
            });
          } catch {}
        }
      }
    })();

    res.json({ jobId, status: "queued" });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── Render a motion graphic card as PNG → R2 ──

app.post("/render-motion-graphic", async (req, res) => {
  const { spec, projectId, sceneIndex, label } = req.body;
  if (!spec) return res.status(400).json({ error: "Missing spec" });

  const jobId = uuid();
  const outputPath = path.join(os.tmpdir(), `mg-${jobId}.png`);

  try {
    if (typeof spec === "string") {
      // pipe-delimited string — parse and render using the spec helper
      await renderMotionGraphicFromSpec(spec, outputPath, label || undefined);
    } else {
      // MotionGraphicSpec object — render directly
      await renderMotionGraphic(spec as import("./motion-graphic-renderer").MotionGraphicSpec, outputPath);
    }
    const r2Key = `graphics/${projectId || "shared"}/scene-${String(sceneIndex || jobId).padStart(3, "0")}.png`;
    const publicUrl = await uploadToR2(outputPath, r2Key, "image/png");
    await fs.unlink(outputPath).catch(() => {});
    res.json({ success: true, url: publicUrl });
  } catch (err) {
    await fs.unlink(outputPath).catch(() => {});
    res.status(500).json({ error: String(err) });
  }
});

// Check job status
app.get("/status/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`MindArchive Worker running on port ${PORT}`);
});
