"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Play,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  SkipForward,
  RefreshCw,
} from "lucide-react";
import type { StepResult, StepStatus } from "@/types";
import type { StepDef } from "./constants";

export function statusIcon(status: StepStatus | "pending") {
  switch (status) {
    case "completed": return <CheckCircle className="h-4 w-4 text-green-500" />;
    case "failed": return <XCircle className="h-4 w-4 text-red-500" />;
    case "running": return <Loader2 className="h-4 w-4 text-primary animate-spin" />;
    case "skipped": return <SkipForward className="h-4 w-4 text-muted-foreground" />;
    default: return <Clock className="h-4 w-4 text-muted-foreground" />;
  }
}

export function statusVariant(status: string): "success" | "destructive" | "default" | "outline" {
  switch (status) {
    case "completed": return "success";
    case "failed": return "destructive";
    case "running": return "default";
    default: return "outline";
  }
}

export function StepRow({ def, stepData, currentStep, running, onRetry, onRunFrom, onRunSingle, canRunSingle }: {
  def: StepDef;
  stepData?: StepResult;
  currentStep: string | null;
  running: boolean;
  onRetry: (id: string) => void;
  onRunFrom: (id: string) => void;
  onRunSingle: (id: string) => void;
  canRunSingle: boolean;
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
        <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onRetry(def.id); }}>
          <RefreshCw className="h-3 w-3 mr-1" /> Retry
        </Button>
      )}
      {!running && status === "completed" && (
        <>
          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onRunSingle(def.id); }}>
            <RefreshCw className="h-3 w-3 mr-1" /> Re-run
          </Button>
          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onRunFrom(def.id); }}>
            <Play className="h-3 w-3 mr-1" /> Run from here
          </Button>
        </>
      )}
      {!running && canRunSingle && status !== "completed" && status !== "failed" && (
        <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onRunSingle(def.id); }}>
          <Play className="h-3 w-3 mr-1" /> Run
        </Button>
      )}
      <Badge variant={statusVariant(status)} className="text-xs">{status}</Badge>
      {stepData?.modified_at && stepData.completed_at && stepData.modified_at > stepData.completed_at && (
        <Badge variant="outline" className="text-xs border-amber-500/50 text-amber-500">modified</Badge>
      )}
    </div>
  );
}
