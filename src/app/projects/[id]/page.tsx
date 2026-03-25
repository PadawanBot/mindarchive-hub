"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
  RefreshCw,
} from "lucide-react";
import type { Project, StepResult, StepStatus } from "@/types";

// Must match src/lib/pipeline/steps.ts
const STEPS = [
  { id: "topic_research", label: "Topic Research", phase: "pre_production", order: 1 },
  { id: "script_writing", label: "Script Writing", phase: "pre_production", order: 2 },
  { id: "hook_engineering", label: "Hook Engineering", phase: "pre_production", order: 3 },
  { id: "voice_selection", label: "Voice Selection", phase: "pre_production", order: 4 },
  { id: "visual_direction", label: "Visual Direction", phase: "pre_production", order: 5 },
  { id: "blend_curator", label: "Blend Curator", phase: "pre_production", order: 6 },
  { id: "brand_assets", label: "Brand Assets", phase: "pre_production", order: 7 },
  { id: "script_refinement", label: "Script Refinement", phase: "pre_production", order: 8 },
  { id: "timing_sync", label: "Timing Sync", phase: "pre_production", order: 9 },
  { id: "thumbnail_creation", label: "Thumbnail Creation", phase: "pre_production", order: 10 },
  { id: "retention_structure", label: "Retention Structure", phase: "pre_production", order: 11 },
  { id: "comment_magnet", label: "Comment Magnet", phase: "pre_production", order: 12 },
  { id: "upload_blueprint", label: "Upload Blueprint", phase: "pre_production", order: 13 },
  { id: "voiceover_generation", label: "Voiceover Generation", phase: "production", order: 14 },
  { id: "image_generation", label: "Image Generation", phase: "production", order: 15 },
  { id: "stock_footage", label: "Stock Footage", phase: "production", order: 16 },
  { id: "motion_graphics", label: "Motion Graphics", phase: "production", order: 17 },
  { id: "hero_scenes", label: "Hero Scenes", phase: "production", order: 18 },
];

const PRE_PROD_STEPS = STEPS.filter(s => s.phase === "pre_production");
const PROD_STEPS = STEPS.filter(s => s.phase === "production");

// Step output display names (maps output key to readable label)
const OUTPUT_LABELS: Record<string, string> = {
  research: "Topic Research",
  script: "Script",
  hooks: "Hooks",
  voice_params: "Voice Parameters",
  visuals: "Visual Direction",
  blend_plan: "Blend Plan",
  brand: "Brand Assets",
  refined_script: "Refined Script",
  timing: "Timing Sync",
  thumbnails: "Thumbnail Concepts",
  retention: "Retention Structure",
  engagement: "Comment Magnets",
  upload: "Upload Blueprint",
};

function statusIcon(status: StepStatus | "pending") {
  switch (status) {
    case "completed": return <CheckCircle className="h-4 w-4 text-green-500" />;
    case "failed": return <XCircle className="h-4 w-4 text-red-500" />;
    case "running": return <Loader2 className="h-4 w-4 text-primary animate-spin" />;
    case "skipped": return <SkipForward className="h-4 w-4 text-muted-foreground" />;
    default: return <Clock className="h-4 w-4 text-muted-foreground" />;
  }
}

function statusVariant(status: string): "success" | "destructive" | "default" | "outline" {
  switch (status) {
    case "completed": return "success";
    case "failed": return "destructive";
    case "running": return "default";
    default: return "outline";
  }
}

function StepRow({ def, stepData, currentStep, running, onRetry }: {
  def: typeof STEPS[0];
  stepData?: StepResult;
  currentStep: string | null;
  running: boolean;
  onRetry: (id: string) => void;
}) {
  const status: StepStatus = currentStep === def.id ? "running" : (stepData?.status || "pending");
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted">
      {statusIcon(status)}
      <span className="text-sm font-medium flex-1">
        <span className="text-muted-foreground mr-2">{def.order}.</span>
        {def.label}
      </span>
      {stepData?.duration_ms && stepData.duration_ms > 0 && (
        <span className="text-xs text-muted-foreground">{(stepData.duration_ms / 1000).toFixed(1)}s</span>
      )}
      {stepData?.cost_cents && stepData.cost_cents > 0 && (
        <span className="text-xs text-muted-foreground">${(stepData.cost_cents / 100).toFixed(3)}</span>
      )}
      {status === "failed" && !running && (
        <Button variant="ghost" size="sm" onClick={() => onRetry(def.id)}>
          <RefreshCw className="h-3 w-3 mr-1" /> Retry
        </Button>
      )}
      <Badge variant={statusVariant(status)} className="text-xs">{status}</Badge>
    </div>
  );
}

export default function ProjectDetailPage() {
  const params = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [steps, setSteps] = useState<StepResult[]>([]);
  const [running, setRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef(false);

  const loadProject = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${params.id}`);
      const text = await res.text();
      if (text) { const d = JSON.parse(text); if (d.success) setProject(d.data); }
    } catch {}
  }, [params.id]);

  const loadSteps = useCallback(async () => {
    try {
      const res = await fetch(`/api/pipeline/steps?project_id=${params.id}`);
      const text = await res.text();
      if (text) { const d = JSON.parse(text); if (d.success) setSteps(d.data); }
    } catch {}
  }, [params.id]);

  useEffect(() => {
    loadProject();
    loadSteps();
  }, [loadProject, loadSteps]);

  const runStep = async (stepId: string): Promise<boolean> => {
    setCurrentStep(stepId);
    setError(null);
    try {
      // Phase 1: Prepare — validate, mark running, get prompt
      const prepRes = await fetch("/api/pipeline/step/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: params.id, step: stepId }),
      });
      const prepText = await prepRes.text();
      if (!prepText) { setError(`Empty response preparing step ${stepId}`); return false; }
      let prepData;
      try { prepData = JSON.parse(prepText); } catch {
        setError(`Step "${stepId}" prepare returned non-JSON (HTTP ${prepRes.status}): ${prepText.slice(0, 200)}`);
        return false;
      }
      if (!prepData.success) { setError(prepData.error || `Step ${stepId} prepare failed`); return false; }

      // Already completed (idempotent)
      if (prepData.data.already_completed) {
        await loadSteps();
        return true;
      }

      // Non-LLM step — run via the old single-call endpoint
      if (!prepData.data.needs_llm) {
        const res = await fetch("/api/pipeline/step", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project_id: params.id, step: stepId }),
        });
        const text = await res.text();
        if (!text) { setError(`Empty response for step ${stepId}`); return false; }
        let data;
        try { data = JSON.parse(text); } catch {
          setError(`Step "${stepId}" returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
          return false;
        }
        if (!data.success) { setError(data.error || `Step ${stepId} failed`); return false; }
        await loadSteps();
        return true;
      }

      // Phase 2: Stream LLM response (client collects tokens)
      const { provider, model, system, prompt, maxTokens } = prepData.data;
      const llmRes = await fetch("/api/pipeline/llm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, model, system, prompt, maxTokens }),
      });

      if (!llmRes.ok || !llmRes.body) {
        const errText = await llmRes.text();
        setError(`LLM call failed (HTTP ${llmRes.status}): ${errText.slice(0, 200)}`);
        return false;
      }

      // Read SSE stream and collect tokens
      const reader = llmRes.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";
      let inputTokens = 0;
      let outputTokens = 0;
      let llmError = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === "text") fullText += evt.text;
            else if (evt.type === "done") { inputTokens = evt.inputTokens; outputTokens = evt.outputTokens; }
            else if (evt.type === "error") llmError = evt.error;
          } catch {}
        }
      }

      if (llmError) { setError(`LLM error: ${llmError}`); return false; }
      if (!fullText) { setError(`No text generated for step ${stepId}`); return false; }

      // Phase 3: Save result
      const saveRes = await fetch("/api/pipeline/step/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: params.id,
          step: stepId,
          text: fullText,
          inputTokens,
          outputTokens,
          truncated: false,
        }),
      });
      const saveText = await saveRes.text();
      if (!saveText) { setError(`Empty response saving step ${stepId}`); return false; }
      let saveData;
      try { saveData = JSON.parse(saveText); } catch {
        setError(`Save returned non-JSON (HTTP ${saveRes.status}): ${saveText.slice(0, 200)}`);
        return false;
      }
      if (!saveData.success) { setError(saveData.error || `Save step ${stepId} failed`); return false; }

      await loadSteps();
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    }
  };

  const runAllSteps = async () => {
    setRunning(true);
    setError(null);
    abortRef.current = false;

    let freshSteps: StepResult[] = [];
    try {
      const res = await fetch(`/api/pipeline/steps?project_id=${params.id}`);
      const d = await res.json();
      if (d.success) freshSteps = d.data;
    } catch {}

    for (const step of STEPS) {
      if (abortRef.current) break;
      const existing = freshSteps.find(s => s.step === step.id);
      if (existing?.status === "completed" || existing?.status === "skipped") continue;

      const ok = await runStep(step.id);
      if (!ok) break;

      try {
        const res = await fetch(`/api/pipeline/steps?project_id=${params.id}`);
        const d = await res.json();
        if (d.success) freshSteps = d.data;
      } catch {}
    }

    setCurrentStep(null);
    setRunning(false);
    await loadProject();
  };

  const stopPipeline = () => {
    abortRef.current = true;
  };

  if (!project) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const completedCount = steps.filter(s => s.status === "completed" || s.status === "skipped").length;
  const totalCost = steps.reduce((sum, s) => sum + (s.cost_cents || 0), 0);

  // Collect completed step outputs for display below the pipeline
  const completedOutputs = steps
    .filter(s => s.status === "completed" && s.output && Object.keys(s.output).length > 0)
    .map(s => {
      const def = STEPS.find(d => d.id === s.step);
      // Find the main text value in the output
      let mainText = "";
      let label = def?.label || s.step;
      for (const [key, val] of Object.entries(s.output!)) {
        if (typeof val === "string" && val.length > 50) {
          mainText = val;
          if (OUTPUT_LABELS[key]) label = OUTPUT_LABELS[key];
          break;
        }
      }
      if (!mainText) mainText = JSON.stringify(s.output, null, 2);
      return { step: s.step, label, text: mainText, order: def?.order || 0 };
    })
    .sort((a, b) => a.order - b.order);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/projects">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{project.title}</h1>
            <Badge variant={statusVariant(project.status)}>{project.status}</Badge>
          </div>
          <p className="text-muted-foreground mt-1">{project.topic}</p>
        </div>
        <div className="flex gap-2">
          {running ? (
            <Button variant="outline" onClick={stopPipeline}>
              <XCircle className="h-4 w-4 mr-2" /> Stop
            </Button>
          ) : (
            <Button onClick={runAllSteps} disabled={project.status === "completed"}>
              <Play className="h-4 w-4 mr-2" />
              {completedCount > 0 ? "Resume Pipeline" : "Run Pipeline"}
            </Button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="flex items-center gap-3">
        <div className="flex-1 bg-muted rounded-full h-2">
          <div
            className="bg-primary h-2 rounded-full transition-all duration-300"
            style={{ width: `${(completedCount / STEPS.length) * 100}%` }}
          />
        </div>
        <span className="text-sm text-muted-foreground">{completedCount}/{STEPS.length}</span>
        {totalCost > 0 && (
          <span className="text-sm text-muted-foreground">${(totalCost / 100).toFixed(3)}</span>
        )}
      </div>

      {/* Error */}
      {error && (
        <Card className="border-red-500/50">
          <CardContent className="flex items-start gap-3 text-red-400">
            <AlertCircle className="h-5 w-5 mt-0.5 shrink-0" />
            <p className="text-sm">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Pre-Production Steps */}
      <Card>
        <CardTitle className="flex items-center gap-2">
          Pre-Production
          <Badge variant="outline" className="text-xs">{PRE_PROD_STEPS.length} steps</Badge>
        </CardTitle>
        <CardContent className="mt-4 space-y-2">
          {PRE_PROD_STEPS.map((def) => (
            <StepRow
              key={def.id}
              def={def}
              stepData={steps.find(s => s.step === def.id)}
              currentStep={currentStep}
              running={running}
              onRetry={runStep}
            />
          ))}
        </CardContent>
      </Card>

      {/* Production Steps */}
      <Card>
        <CardTitle className="flex items-center gap-2">
          Production
          <Badge variant="outline" className="text-xs">{PROD_STEPS.length} steps</Badge>
        </CardTitle>
        <CardContent className="mt-4 space-y-2">
          {PROD_STEPS.map((def) => (
            <StepRow
              key={def.id}
              def={def}
              stepData={steps.find(s => s.step === def.id)}
              currentStep={currentStep}
              running={running}
              onRetry={runStep}
            />
          ))}
        </CardContent>
      </Card>

      {/* Step Outputs — shown below pipeline like the Script card */}
      {completedOutputs.length > 0 && (
        <Card>
          <CardTitle>Step Outputs</CardTitle>
          <CardContent className="mt-4 space-y-6">
            {completedOutputs
              .filter(o => o.step !== "script_writing" && o.step !== "script_refinement")
              .map((o) => (
                <div key={o.step}>
                  <h3 className="text-sm font-semibold text-muted-foreground mb-2">{o.label}</h3>
                  <pre className="whitespace-pre-wrap text-sm bg-muted p-4 rounded-lg max-h-64 overflow-y-auto">
                    {o.text}
                  </pre>
                </div>
              ))}
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
    </div>
  );
}
