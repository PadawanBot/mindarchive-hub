"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Play,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  SkipForward,
  AlertCircle,
} from "lucide-react";
import type { Project } from "@/types";

interface PipelineStepResult {
  step: string;
  status: "completed" | "failed" | "skipped";
  output?: Record<string, unknown>;
  error?: string;
  cost_cents?: number;
  duration_ms?: number;
}

const stepLabels: Record<string, string> = {
  topic_research: "Topic Research",
  script_writing: "Script Writing",
  hook_generation: "Hook Engineering",
  script_refinement: "Script Refinement",
  voiceover_generation: "Voiceover Generation",
  visual_direction: "Visual Direction",
  thumbnail_creation: "Thumbnail Creation",
  video_assembly: "Video Assembly",
};

const statusIcon = {
  pending: <Clock className="h-4 w-4 text-muted-foreground" />,
  running: <Loader2 className="h-4 w-4 text-primary animate-spin" />,
  completed: <CheckCircle className="h-4 w-4 text-success" />,
  failed: <XCircle className="h-4 w-4 text-destructive" />,
  skipped: <SkipForward className="h-4 w-4 text-muted-foreground" />,
};

function getSteps(project: Project): PipelineStepResult[] {
  const meta = project.metadata as Record<string, unknown> | undefined;
  if (meta?.pipeline_steps && Array.isArray(meta.pipeline_steps)) {
    return meta.pipeline_steps as PipelineStepResult[];
  }
  return [];
}

export default function ProjectDetailPage() {
  const params = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [running, setRunning] = useState(false);
  const [pipelineError, setPipelineError] = useState<string | null>(null);

  const loadProject = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${params.id}`);
      const text = await res.text();
      if (!text) return;
      const data = JSON.parse(text);
      if (data.success) setProject(data.data);
    } catch {}
  }, [params.id]);

  useEffect(() => {
    loadProject();
  }, [loadProject]);

  const runPipeline = async () => {
    setRunning(true);
    setPipelineError(null);
    try {
      const res = await fetch(`/api/pipeline/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: params.id }),
      });
      const text = await res.text();
      if (!text) {
        setPipelineError(`Server returned empty response (status ${res.status})`);
        setRunning(false);
        return;
      }
      const data = JSON.parse(text);
      if (!data.success) {
        setPipelineError(data.error || "Pipeline failed");
      }
      // Reload project to get updated data
      await loadProject();
    } catch (err) {
      setPipelineError(String(err));
    } finally {
      setRunning(false);
    }
  };

  if (!project) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const steps = getSteps(project);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/projects">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{project.title}</h1>
            <Badge
              variant={
                project.status === "completed"
                  ? "success"
                  : project.status === "failed"
                  ? "destructive"
                  : "default"
              }
            >
              {project.status}
            </Badge>
          </div>
          <p className="text-muted-foreground mt-1">{project.topic}</p>
        </div>
        {(project.status === "draft" || project.status === "failed") && (
          <Button onClick={runPipeline} disabled={running}>
            {running ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Play className="h-4 w-4 mr-2" />
            )}
            {running ? "Running..." : "Run Pipeline"}
          </Button>
        )}
      </div>

      {/* Error */}
      {pipelineError && (
        <Card className="border-red-500/50">
          <CardContent className="flex items-start gap-3 text-red-400">
            <AlertCircle className="h-5 w-5 mt-0.5 shrink-0" />
            <p className="text-sm">{pipelineError}</p>
          </CardContent>
        </Card>
      )}

      {/* Pipeline Steps */}
      <Card>
        <CardTitle>Pipeline Progress</CardTitle>
        <CardContent className="mt-4">
          <div className="space-y-2">
            {steps.map((step) => (
              <div
                key={step.step}
                className="flex items-center gap-3 p-3 rounded-lg bg-muted"
              >
                {statusIcon[step.status] || statusIcon.pending}
                <span className="text-sm font-medium flex-1">
                  {stepLabels[step.step] || step.step}
                </span>
                {step.duration_ms && step.duration_ms > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {(step.duration_ms / 1000).toFixed(1)}s
                  </span>
                )}
                {step.cost_cents && step.cost_cents > 0 && (
                  <span className="text-xs text-muted-foreground">
                    ${(step.cost_cents / 100).toFixed(3)}
                  </span>
                )}
                <Badge
                  variant={
                    step.status === "completed"
                      ? "success"
                      : step.status === "failed"
                      ? "destructive"
                      : "outline"
                  }
                  className="text-xs"
                >
                  {step.status}
                </Badge>
              </div>
            ))}
            {steps.length === 0 && !running && (
              <p className="text-sm text-muted-foreground text-center py-4">
                Pipeline not started yet. Click &quot;Run Pipeline&quot; to begin.
              </p>
            )}
            {steps.length === 0 && running && (
              <div className="flex items-center justify-center gap-2 py-4">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">
                  Pipeline is running... this may take 30-60 seconds.
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Cost Summary */}
      {project.total_cost_cents > 0 && (
        <Card>
          <CardTitle>Cost</CardTitle>
          <CardContent className="mt-4">
            <p className="text-2xl font-bold">${(project.total_cost_cents / 100).toFixed(3)}</p>
            <p className="text-sm text-muted-foreground">Total API spend</p>
          </CardContent>
        </Card>
      )}

      {/* Script Preview */}
      {project.script_data && (
        <Card>
          <CardTitle>Script</CardTitle>
          <CardContent className="mt-4">
            <pre className="whitespace-pre-wrap text-sm bg-muted p-4 rounded-lg max-h-96 overflow-y-auto">
              {typeof project.script_data === "object" && (project.script_data as Record<string, string>).refined
                ? (project.script_data as Record<string, string>).refined
                : typeof project.script_data === "object" && (project.script_data as Record<string, string>).raw
                ? (project.script_data as Record<string, string>).raw
                : JSON.stringify(project.script_data, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Output */}
      {project.output_url && (
        <Card>
          <CardTitle>Output</CardTitle>
          <CardContent className="mt-4">
            <a
              href={project.output_url}
              className="text-primary underline text-sm"
              target="_blank"
              rel="noopener noreferrer"
            >
              Download Final Video
            </a>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
