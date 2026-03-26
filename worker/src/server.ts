import express from "express";
import { assembleVideo } from "./assembler";
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
app.use("/status", authMiddleware);

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
  (async () => {
    try {
      job.status = "downloading";
      job.progress = 10;

      const result = await assembleVideo(manifest, (progress) => {
        job.progress = progress;
        if (progress < 50) job.status = "downloading";
        else if (progress < 90) job.status = "rendering";
        else job.status = "uploading";
      });

      job.status = "completed";
      job.progress = 100;
      job.outputUrl = result.outputUrl;
      job.completedAt = new Date().toISOString();

      // Callback to Vercel
      if (callbackUrl) {
        try {
          await fetch(callbackUrl, {
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
        } catch (err) {
          console.error("Callback failed:", err);
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
