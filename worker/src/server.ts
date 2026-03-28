import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { assembleVideo, assembleVideoV2 } from "./assembler";
import { timingFromAudioUrl } from "./timing-from-audio";
import { renderMotionGraphic, type MotionGraphicSpec } from "./motion-graphic-renderer";
import { v4 as uuid } from "uuid";

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

// ── Render a motion graphic card as PNG ──

app.post("/render-motion-graphic", async (req, res) => {
  try {
    const { spec, width, height } = req.body as {
      spec: MotionGraphicSpec;
      width?: number;
      height?: number;
    };

    if (!spec) {
      return res.status(400).json({ error: "Missing spec" });
    }

    const png = await renderMotionGraphic(spec, {
      width: width || 1920,
      height: height || 1080,
    });

    res.setHeader("Content-Type", "image/png");
    res.send(png);
  } catch (err) {
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
