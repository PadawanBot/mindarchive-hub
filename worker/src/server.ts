import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { assembleVideo, assembleVideoV2 } from "./assembler";
import { timingFromAudioUrl } from "./timing-from-audio";
import { renderMotionGraphic } from "./motion-graphic-renderer";
import { uploadToR2 } from "./r2-upload";
import { v4 as uuid } from "uuid";
import * as path from "path";
import * as os from "os";
import * as fs from "fs/promises";

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
      const message = await client.messages.create({
        model: llmModel,
        max_tokens: maxTokens || 16384,
        system,
        messages: [{ role: "user", content: prompt }],
      });

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
  const { projectId, prompts, callbackUrl } = req.body;

  if (!projectId || !prompts?.length) {
    return res.status(400).json({ error: "Missing projectId or prompts" });
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    return res.status(500).json({ error: "OPENAI_API_KEY not configured on worker" });
  }

  const jobId = uuid();
  console.log(`[images] Job ${jobId}: ${prompts.length} DALL-E prompts for project ${projectId}`);
  res.json({ jobId, status: "queued" });

  // Run async
  (async () => {
    try {
      const batchSize = 5;
      const maxImages = Math.min(prompts.length, 15);
      const images: { url: string; prompt: string; revised_prompt: string; stored: boolean }[] = [];

      // Phase 1: Generate in parallel batches
      for (let batch = 0; batch < maxImages; batch += batchSize) {
        const batchPrompts = (prompts as string[]).slice(batch, batch + batchSize);
        console.log(`[images] Job ${jobId}: batch ${Math.floor(batch / batchSize) + 1} — ${batchPrompts.length} images`);

        const results = await Promise.all(
          batchPrompts.map(async (prompt: string, batchIdx: number) => {
            const i = batch + batchIdx;
            try {
              const dalleRes = await fetch("https://api.openai.com/v1/images/generations", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${openaiKey}`,
                },
                body: JSON.stringify({
                  model: "dall-e-3",
                  prompt,
                  n: 1,
                  size: "1792x1024",
                  quality: "hd",
                }),
              });

              if (!dalleRes.ok) {
                const err = await dalleRes.text();
                console.error(`[images] Job ${jobId}: DALL-E ${i + 1} failed: ${err.slice(0, 200)}`);
                return null;
              }

              const dalleData = await dalleRes.json() as {
                data: { url: string; revised_prompt: string }[];
              };
              const imgUrl = dalleData.data[0]?.url;
              const revisedPrompt = dalleData.data[0]?.revised_prompt || "";

              if (!imgUrl) return null;

              // Download and upload to R2
              const imgRes = await fetch(imgUrl);
              if (!imgRes.ok) return null;
              const imgBuffer = Buffer.from(await imgRes.arrayBuffer());

              const tmpPath = path.join(os.tmpdir(), `dalle-${jobId}-${i}.png`);
              await fs.writeFile(tmpPath, imgBuffer);

              const r2Key = `images/${projectId}/dalle-scene-${String(i + 1).padStart(3, "0")}.png`;
              const publicUrl = await uploadToR2(tmpPath, r2Key, "image/png");
              await fs.unlink(tmpPath).catch(() => {});

              return { url: publicUrl, prompt, revised_prompt: revisedPrompt, stored: true };
            } catch (err) {
              console.error(`[images] Job ${jobId}: image ${i + 1} failed:`, err);
              return null;
            }
          })
        );

        images.push(...results.filter(Boolean) as typeof images);
      }

      console.log(`[images] Job ${jobId}: completed — ${images.length}/${maxImages} images generated`);

      if (callbackUrl) {
        try {
          await fetch(callbackUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId,
              step: "image_generation",
              status: "completed",
              output: {
                status: "completed",
                images,
                total_prompts: prompts.length,
                generated: images.length,
              },
              cost_cents: images.length * 8, // ~$0.08 per DALL-E 3 HD
            }),
          });
        } catch (err) {
          console.error(`[images] Job ${jobId}: callback failed:`, err);
        }
      }
    } catch (err) {
      console.error(`[images] Job ${jobId} failed:`, err);
      if (callbackUrl) {
        try {
          await fetch(callbackUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId,
              step: "image_generation",
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

app.post("/generate-voiceover", async (req, res) => {
  const { projectId, text, voiceId, modelId, voiceSettings, elevenLabsKey, callbackUrl } = req.body;

  if (!projectId || !text || !voiceId || !elevenLabsKey) {
    return res.status(400).json({ error: "Missing projectId, text, voiceId, or elevenLabsKey" });
  }

  const jobId = uuid();
  const wordCount = text.split(/\s+/).length;
  console.log(`[voiceover] Job ${jobId}: ${wordCount} words, voice ${voiceId}`);
  res.json({ jobId, status: "queued" });

  // Run async
  (async () => {
    try {
      const ttsRes = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
        {
          method: "POST",
          headers: {
            "xi-api-key": elevenLabsKey,
            "Content-Type": "application/json",
            Accept: "audio/mpeg",
          },
          body: JSON.stringify({
            text,
            model_id: modelId || "eleven_multilingual_v2",
            voice_settings: voiceSettings || {
              stability: 0.5,
              similarity_boost: 0.75,
              style: 0.5,
              use_speaker_boost: true,
            },
          }),
        }
      );

      if (!ttsRes.ok) {
        const errText = await ttsRes.text();
        throw new Error(`ElevenLabs API error ${ttsRes.status}: ${errText.slice(0, 300)}`);
      }

      // Read full audio stream
      const chunks: Buffer[] = [];
      const reader = ttsRes.body?.getReader();
      if (!reader) throw new Error("No response body from ElevenLabs");

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(Buffer.from(value));
      }

      const audioBuffer = Buffer.concat(chunks);
      const totalBytes = audioBuffer.length;
      console.log(`[voiceover] Job ${jobId}: received ${(totalBytes / 1024 / 1024).toFixed(1)} MB audio`);

      // Upload to R2
      const tmpPath = path.join(os.tmpdir(), `voiceover-${jobId}.mp3`);
      await fs.writeFile(tmpPath, audioBuffer);

      const r2Key = `audio/${projectId}/voiceover.mp3`;
      const audioUrl = await uploadToR2(tmpPath, r2Key, "audio/mpeg");
      await fs.unlink(tmpPath).catch(() => {});

      const estimatedDurationMin = Math.round(wordCount / 150 * 10) / 10;

      console.log(`[voiceover] Job ${jobId}: uploaded to ${audioUrl}`);

      if (callbackUrl) {
        try {
          await fetch(callbackUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId,
              step: "voiceover_generation",
              status: "completed",
              output: {
                status: "completed",
                voice_id: voiceId,
                narration_length: text.length,
                word_count: wordCount,
                estimated_duration_minutes: estimatedDurationMin,
                audio_confirmed: true,
                audio_url: audioUrl,
                audio_size_bytes: totalBytes,
                note: "Audio uploaded to R2 via worker.",
              },
              cost_cents: Math.ceil(text.length * 0.003),
            }),
          });
        } catch (err) {
          console.error(`[voiceover] Job ${jobId}: callback failed:`, err);
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
              projectId,
              step: "voiceover_generation",
              status: "failed",
              error: String(err),
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
  const { projectId, scenes, runwayKey, callbackUrl } = req.body as {
    projectId: string;
    scenes: { section: string; promptText: string }[];
    runwayKey: string;
    callbackUrl?: string;
  };

  if (!projectId || !scenes?.length || !runwayKey) {
    return res.status(400).json({ error: "Missing projectId, scenes, or runwayKey" });
  }

  const jobId = uuid();
  console.log(`[hero] Job ${jobId}: ${scenes.length} Runway scenes for project ${projectId}`);
  res.json({ jobId, status: "queued" });

  // Run async
  (async () => {
    try {
      const RUNWAY_API = "https://api.dev.runwayml.com/v1";
      const completed: { section: string; video_url: string; taskId: string }[] = [];

      // Submit all scenes in parallel
      const tasks = await Promise.all(
        scenes.slice(0, 5).map(async (scene) => {
          try {
            const submitRes = await fetch(`${RUNWAY_API}/text_to_video`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${runwayKey}`,
                "X-Runway-Version": "2024-11-06",
              },
              body: JSON.stringify({
                model: "gen4_turbo",
                promptText: scene.promptText.slice(0, 1000),
                duration: 5,
                ratio: "1280:720",
              }),
            });

            if (!submitRes.ok) {
              const err = await submitRes.text();
              console.error(`[hero] Job ${jobId}: Runway submit failed for "${scene.section}": ${err.slice(0, 200)}`);
              return null;
            }

            const { id: taskId } = await submitRes.json() as { id: string };
            console.log(`[hero] Job ${jobId}: submitted "${scene.section}" → task ${taskId}`);
            return { section: scene.section, taskId };
          } catch (err) {
            console.error(`[hero] Job ${jobId}: submit error for "${scene.section}":`, err);
            return null;
          }
        })
      );

      const activeTasks = tasks.filter(Boolean) as { section: string; taskId: string }[];
      console.log(`[hero] Job ${jobId}: ${activeTasks.length}/${scenes.length} tasks submitted, polling...`);

      // Poll all tasks in parallel until done (max 5 min)
      const MAX_POLL = 60; // 60 * 5s = 5 min
      const pending = new Set(activeTasks.map(t => t.taskId));

      for (let poll = 0; poll < MAX_POLL && pending.size > 0; poll++) {
        await new Promise(r => setTimeout(r, 5000));

        for (const task of activeTasks) {
          if (!pending.has(task.taskId)) continue;

          try {
            const statusRes = await fetch(`${RUNWAY_API}/tasks/${task.taskId}`, {
              headers: {
                Authorization: `Bearer ${runwayKey}`,
                "X-Runway-Version": "2024-11-06",
              },
            });

            if (!statusRes.ok) continue;
            const status = await statusRes.json() as { status: string; output?: string[]; failure?: string };

            if (status.status === "SUCCEEDED" && status.output?.[0]) {
              pending.delete(task.taskId);
              const videoUrl = status.output[0];

              // Download and upload to R2
              try {
                const vidRes = await fetch(videoUrl);
                if (vidRes.ok) {
                  const vidBuffer = Buffer.from(await vidRes.arrayBuffer());
                  const tmpPath = path.join(os.tmpdir(), `runway-${jobId}-${task.taskId}.mp4`);
                  await fs.writeFile(tmpPath, vidBuffer);

                  const sceneIdx = activeTasks.indexOf(task) + 1;
                  const r2Key = `runway/${projectId}/scene-${String(sceneIdx).padStart(3, "0")}.mp4`;
                  const publicUrl = await uploadToR2(tmpPath, r2Key, "video/mp4");
                  await fs.unlink(tmpPath).catch(() => {});

                  completed.push({ section: task.section, video_url: publicUrl, taskId: task.taskId });
                  console.log(`[hero] Job ${jobId}: "${task.section}" completed → ${publicUrl}`);
                }
              } catch (err) {
                console.error(`[hero] Job ${jobId}: failed to download/upload "${task.section}":`, err);
                completed.push({ section: task.section, video_url: videoUrl, taskId: task.taskId });
              }
            } else if (status.status === "FAILED") {
              pending.delete(task.taskId);
              console.error(`[hero] Job ${jobId}: "${task.section}" failed: ${status.failure}`);
            }
          } catch {}
        }
      }

      if (pending.size > 0) {
        console.warn(`[hero] Job ${jobId}: ${pending.size} tasks timed out after 5 min`);
      }

      console.log(`[hero] Job ${jobId}: completed — ${completed.length}/${activeTasks.length} scenes`);

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
                scenes: completed,
                status: "completed",
                tasks_started: activeTasks.length,
                total_requested: scenes.length,
              },
              cost_cents: completed.length * 5, // ~$0.05 per Runway clip
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
            body: JSON.stringify({
              projectId,
              step: "hero_scenes",
              status: "failed",
              error: String(err),
            }),
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
  const { spec, projectId, sceneIndex } = req.body;
  if (!spec) return res.status(400).json({ error: "Missing spec" });

  const jobId = uuid();
  const outputPath = path.join(os.tmpdir(), `mg-${jobId}.png`);

  try {
    await renderMotionGraphic(spec, outputPath);
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
