"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useVideoAssembler } from "@/lib/video/assembler";
import { downloadRenderPackage } from "@/lib/video/render-package";
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
  AlertCircle,
  RefreshCw,
  Download,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import type { Project, StepResult } from "@/types";
import { STEPS, PRE_PROD_STEPS, PROD_STEPS, OUTPUT_LABELS } from "@/components/pipeline/constants";
import { StepRow, statusVariant } from "@/components/pipeline/StepRow";
import { StepOutputRenderer } from "@/components/pipeline/StepOutputRenderer";

export default function ProjectDetailPage() {
  const params = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [steps, setSteps] = useState<StepResult[]>([]);
  const [running, setRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { assemble, assembling, progress: assemblyProgress, error: assemblyError } = useVideoAssembler();
  const [packaging, setPackaging] = useState(false);
  const [packageProgress, setPackageProgress] = useState({ stage: "", pct: 0 });
  const abortRef = useRef(false);
  const [preProdCollapsed, setPreProdCollapsed] = useState(false);
  const [expandedOutput, setExpandedOutput] = useState<string | null>(null);

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

  const runStep = async (stepId: string, opts?: { force?: boolean }): Promise<boolean> => {
    setCurrentStep(stepId);
    setError(null);
    const force = opts?.force || false;
    try {
      // Phase 1: Prepare — validate, mark running, get prompt
      const prepRes = await fetch("/api/pipeline/step/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: params.id, step: stepId, force }),
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
          body: JSON.stringify({ project_id: params.id, step: stepId, force }),
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

  const rerunProduction = async () => {
    setRunning(true);
    setError(null);
    abortRef.current = false;

    // Reset production steps (skipped/completed) back to pending
    const prodStepIds = PROD_STEPS.map(s => s.id);
    try {
      const res = await fetch("/api/pipeline/step/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: params.id, steps: prodStepIds }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.error || "Failed to reset steps"); setRunning(false); return; }
    } catch (err) { setError(String(err)); setRunning(false); return; }

    await loadSteps();

    // Run only production steps
    for (const step of PROD_STEPS) {
      if (abortRef.current) break;
      const ok = await runStep(step.id);
      if (!ok) break;
    }

    setCurrentStep(null);
    setRunning(false);
    await loadProject();
  };

  const runFromStep = async (stepId: string) => {
    setRunning(true);
    setError(null);
    abortRef.current = false;

    // Find the starting step and collect all steps from it onward
    const startOrder = STEPS.find(s => s.id === stepId)?.order ?? 1;
    const stepsFromHere = STEPS.filter(s => s.order >= startOrder);
    const stepIds = stepsFromHere.map(s => s.id);

    // Reset those steps back to pending
    try {
      const res = await fetch("/api/pipeline/step/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: params.id, steps: stepIds }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.error || "Failed to reset steps"); setRunning(false); return; }
    } catch (err) { setError(String(err)); setRunning(false); return; }

    await loadSteps();

    // Run only those steps
    for (const step of stepsFromHere) {
      if (abortRef.current) break;
      const ok = await runStep(step.id);
      if (!ok) break;
    }

    setCurrentStep(null);
    setRunning(false);
    await loadProject();
  };

  const runSingleStep = async (stepId: string) => {
    setRunning(true);
    setError(null);
    abortRef.current = false;

    const ok = await runStep(stepId, { force: true });
    if (!ok) {
      // Step failed — error already set by runStep
    }

    setCurrentStep(null);
    setRunning(false);
    await loadSteps();
    await loadProject();
  };

  const stopPipeline = () => {
    abortRef.current = true;
  };

  const assembleVideo = async () => {
    // Gather assets from completed steps
    const voiceoverStep = steps.find(s => s.step === "voiceover_generation" && s.status === "completed");
    const imageStep = steps.find(s => s.step === "image_generation" && s.status === "completed");
    const timingStep = steps.find(s => s.step === "timing_sync" && s.status === "completed");

    const audioUrl = (voiceoverStep?.output as Record<string, unknown>)?.audio_url as string | undefined;
    if (!audioUrl) {
      setError("Voiceover audio not available. Re-run Voiceover Generation step first (it needs to save the MP3 to storage).");
      return;
    }

    // Get images
    const images = ((imageStep?.output as Record<string, unknown>)?.images as { url: string }[]) || [];
    if (images.length === 0) {
      setError("No images available. Re-run Image Generation step first.");
      return;
    }

    // Calculate scene durations from timing data or distribute evenly
    let sceneDurations: number[] = [];
    try {
      const timingText = (timingStep?.output as Record<string, unknown>)?.timing as string;
      if (timingText) {
        const parsed = JSON.parse(timingText);
        if (Array.isArray(parsed)) {
          sceneDurations = parsed.map((t: { start_time_seconds: number; end_time_seconds: number }) =>
            t.end_time_seconds - t.start_time_seconds
          );
        }
      }
    } catch {}

    // Build scenes — map images to timing segments
    const voiceoverDuration = ((voiceoverStep?.output as Record<string, unknown>)?.estimated_duration_minutes as number || 7) * 60;
    const scenes = images.map((img, i) => ({
      imageUrl: img.url,
      duration: sceneDurations[i] || Math.round(voiceoverDuration / images.length),
    }));

    const slug = project?.title?.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "video";
    await assemble(audioUrl, scenes, `${slug}.mp4`);
  };

  if (!project) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Check if a step's dependencies (all prior steps by order) are completed
  const canRunSingle = (stepDef: typeof STEPS[0]): boolean => {
    const priorSteps = STEPS.filter(s => s.order < stepDef.order);
    return priorSteps.every(prior => {
      const data = steps.find(s => s.step === prior.id);
      return data?.status === "completed" || data?.status === "skipped";
    });
  };

  const completedCount = steps.filter(s => s.status === "completed" || s.status === "skipped").length;
  const preProdCompleted = PRE_PROD_STEPS.every(def => {
    const s = steps.find(st => st.step === def.id);
    return s?.status === "completed" || s?.status === "skipped";
  });
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
        <div className="flex gap-2 items-center">
          {completedCount > 0 && (
            <div className="flex items-center gap-1 mr-2">
              <span className="text-xs text-muted-foreground">Export:</span>
              <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => window.open(`/api/export?project_id=${params.id}&format=md`, '_blank')}>MD</Button>
              <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => window.open(`/api/export?project_id=${params.id}&format=txt`, '_blank')}>TXT</Button>
              <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => window.open(`/api/export?project_id=${params.id}&format=json`, '_blank')}>JSON</Button>
            </div>
          )}
          {running ? (
            <Button variant="outline" onClick={stopPipeline}>
              <XCircle className="h-4 w-4 mr-2" /> Stop
            </Button>
          ) : (
            <>
              <Button onClick={runAllSteps} disabled={project.status === "completed"}>
                <Play className="h-4 w-4 mr-2" />
                {completedCount > 0 ? "Resume Pipeline" : "Run Pipeline"}
              </Button>
              {project.status === "completed" && (
                <Button variant="outline" onClick={rerunProduction}>
                  <RefreshCw className="h-4 w-4 mr-2" /> Re-run Production
                </Button>
              )}
            </>
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

      {/* Asset source toggles */}
      <Card>
        <CardContent className="flex items-center gap-6 py-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Asset Sources</span>
          {(["dalle_images", "stock_footage", "hero_scenes"] as const).map((key) => {
            const labels = { dalle_images: "DALL-E Images", stock_footage: "Stock Footage", hero_scenes: "Hero Scenes" };
            const profileSources = project.metadata?.profile_asset_sources as Record<string, boolean> | undefined;
            // Resolve: project override > profile defaults > true
            const sources = {
              ...{ dalle_images: true, stock_footage: true, hero_scenes: true },
              ...(profileSources || {}),
              ...(project.asset_sources || {}),
            };
            const enabled = sources[key] !== false;
            return (
              <label key={key} className="flex items-center gap-1.5 text-sm cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={async (e) => {
                    const newSources = { ...(project.asset_sources || {}), [key]: e.target.checked };
                    try {
                      await fetch(`/api/projects/${params.id}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ asset_sources: newSources }),
                      });
                      await loadProject();
                    } catch {}
                  }}
                  disabled={running}
                  className="rounded border-muted-foreground/30"
                />
                <span className={enabled ? "text-foreground" : "text-muted-foreground line-through"}>{labels[key]}</span>
              </label>
            );
          })}
          <span className="text-xs text-muted-foreground ml-auto">Unchecked steps will be skipped</span>
        </CardContent>
      </Card>

      {/* Tab navigation */}
      <div className="flex gap-2 border-b border-muted-foreground/10 pb-1">
        <span className="px-3 py-1.5 text-sm font-medium border-b-2 border-primary text-foreground">
          Pipeline
        </span>
        <Link
          href={`/projects/${params.id}/assets`}
          className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Assets
        </Link>
      </div>

      {/* Pre-Production Steps — collapsible */}
      <Card>
        <button
          onClick={() => setPreProdCollapsed(!preProdCollapsed)}
          className="w-full flex items-center gap-2 p-4 text-left hover:bg-muted/30 transition-colors rounded-t-lg"
        >
          {preProdCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          <span className="font-semibold text-sm flex-1">Pre-Production</span>
          <Badge variant="outline" className="text-xs">
            {steps.filter(s => PRE_PROD_STEPS.some(p => p.id === s.step) && (s.status === "completed" || s.status === "skipped")).length}/{PRE_PROD_STEPS.length}
          </Badge>
          {preProdCompleted && <CheckCircle className="h-4 w-4 text-green-500" />}
        </button>
        {!preProdCollapsed && (
          <CardContent className="pt-0 space-y-2">
            {PRE_PROD_STEPS.map((def) => (
              <StepRow
                key={def.id}
                def={def}
                stepData={steps.find(s => s.step === def.id)}
                currentStep={currentStep}
                running={running}
                onRetry={runStep}
                onRunFrom={runFromStep}
                onRunSingle={runSingleStep}
                canRunSingle={canRunSingle(def)}
                projectId={params.id as string}
              />
            ))}
          </CardContent>
        )}
      </Card>

      {/* Production Steps — always expanded */}
      <Card>
        <div className="flex items-center gap-2 p-4">
          <ChevronDown className="h-4 w-4" />
          <span className="font-semibold text-sm flex-1">Production</span>
          <Badge variant="outline" className="text-xs">
            {steps.filter(s => PROD_STEPS.some(p => p.id === s.step) && (s.status === "completed" || s.status === "skipped")).length}/{PROD_STEPS.length}
          </Badge>
        </div>
        <CardContent className="pt-0 space-y-2">
          {PROD_STEPS.map((def) => (
            <StepRow
              key={def.id}
              def={def}
              stepData={steps.find(s => s.step === def.id)}
              currentStep={currentStep}
              running={running}
              onRetry={runStep}
              onRunFrom={runFromStep}
              onRunSingle={runSingleStep}
              canRunSingle={canRunSingle(def)}
              projectId={params.id as string}
            />
          ))}
        </CardContent>
      </Card>

      {/* Step Outputs — accordion style */}
      {completedOutputs.length > 0 && (
        <Card>
          <div className="p-4">
            <span className="font-semibold text-sm">Step Outputs</span>
            <span className="text-xs text-muted-foreground ml-2">
              {completedOutputs.filter(o => o.step !== "script_writing" && o.step !== "script_refinement").length} steps
            </span>
          </div>
          <CardContent className="pt-0 space-y-1">
            {completedOutputs
              .filter(o => o.step !== "script_writing" && o.step !== "script_refinement")
              .map((o) => {
                const stepData = steps.find(s => s.step === o.step);
                const output = stepData?.output;
                const isExpanded = expandedOutput === o.step;
                return (
                  <div key={o.step} className="border border-muted-foreground/10 rounded-lg overflow-hidden">
                    <button
                      onClick={() => setExpandedOutput(isExpanded ? null : o.step)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/30 transition-colors text-sm"
                    >
                      {isExpanded ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
                      <span className="font-medium flex-1">{o.label}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {stepData?.status || "pending"}
                      </Badge>
                    </button>
                    {isExpanded && (
                      <div className="px-3 pb-3 pt-1">
                        <StepOutputRenderer
                          step={o.step}
                          label={o.label}
                          text={o.text}
                          output={output || {}}
                          projectId={params.id as string}
                          onOutputChanged={loadSteps}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
          </CardContent>
        </Card>
      )}

      {/* Completion Summary */}
      {project.status === "completed" && (
        <Card className="border-green-500/30">
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-500" /> Production Complete
          </CardTitle>
          <CardContent className="mt-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Steps</p>
                <p className="text-lg font-bold">{completedCount}/{STEPS.length}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Cost</p>
                <p className="text-lg font-bold">${(totalCost / 100).toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Duration</p>
                <p className="text-lg font-bold">{Math.round(steps.reduce((sum, s) => sum + (s.duration_ms || 0), 0) / 1000)}s</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Assets</p>
                <p className="text-lg font-bold">
                  {steps.filter(s => ["image_generation", "voiceover_generation", "stock_footage", "hero_scenes"].includes(s.step) && s.status === "completed").length} generated
                </p>
              </div>
            </div>

            {/* Video Output Options */}
            <div className="mt-4 pt-4 border-t border-muted space-y-3">
              <h4 className="text-sm font-semibold">Video Output</h4>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  onClick={async () => {
                    setPackaging(true);
                    try {
                      await downloadRenderPackage(
                        project.title,
                        steps,
                        (stage, pct) => setPackageProgress({ stage, pct })
                      );
                    } catch (err) {
                      setError(String(err));
                    }
                    setPackaging(false);
                  }}
                  disabled={packaging || assembling}
                  variant="primary"
                >
                  {packaging ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> {packageProgress.stage}</>
                  ) : (
                    <><Download className="h-4 w-4 mr-2" /> Download Render Package</>
                  )}
                </Button>
                <Button
                  onClick={assembleVideo}
                  disabled={assembling || packaging}
                  variant="outline"
                >
                  {assembling ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> {assemblyProgress.stage}</>
                  ) : (
                    <><Play className="h-4 w-4 mr-2" /> Quick Preview (Browser)</>
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                <strong>Render Package:</strong> ZIP with timing.json, assets, docs, and Python render script (ffmpeg).
                Produces horizontal + vertical video.
                {" "}<strong>Quick Preview:</strong> Basic browser render (best for clips under 60s — may be slow or crash on longer videos).
              </p>
              {(assembling || packaging) && (
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 bg-muted rounded-full h-2">
                      <div
                        className="bg-primary h-2 rounded-full transition-all duration-500"
                        style={{ width: `${assembling ? assemblyProgress.percent : packageProgress.pct}%` }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {assembling ? `${assemblyProgress.percent}%` : `${packageProgress.pct}%`}
                    </span>
                  </div>
                  {assembling && assemblyProgress.detail && (
                    <p className="text-xs text-muted-foreground">{assemblyProgress.detail}</p>
                  )}
                </div>
              )}
              {assemblyError && (
                <p className="text-xs text-red-400 mt-2">{assemblyError}</p>
              )}
            </div>
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
