"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownItem, DropdownSeparator, DropdownLabel } from "@/components/ui/dropdown-menu";
import {
  Play,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  SkipForward,
  RefreshCw,
  MoreHorizontal,
  Download,
  FastForward,
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

export function StepRow({ def, stepData, currentStep, running, onRetry, onRunFrom, onRunSingle, canRunSingle, projectId }: {
  def: StepDef;
  stepData?: StepResult;
  currentStep: string | null;
  running: boolean;
  onRetry: (id: string) => void;
  onRunFrom: (id: string) => void;
  onRunSingle: (id: string) => void;
  canRunSingle: boolean;
  projectId: string;
}) {
  const status: StepStatus = currentStep === def.id ? "running" : (stepData?.status || "pending");
  const hasCost = stepData?.cost_cents && stepData.cost_cents > 0;
  const hasDuration = stepData?.duration_ms && stepData.duration_ms > 0;
  const isModified = stepData?.modified_at && stepData.completed_at && stepData.modified_at > stepData.completed_at;

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted">
      {statusIcon(status)}

      {/* Step label */}
      <span className="text-sm font-medium flex-1 min-w-0">
        <span className="text-muted-foreground mr-2">{def.order}.</span>
        {def.label}
      </span>

      {/* Compact metadata */}
      {(hasDuration || hasCost) && (
        <span className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground">
          {hasDuration && <span>{(stepData!.duration_ms! / 1000).toFixed(1)}s</span>}
          {hasCost && <span>${(stepData!.cost_cents! / 100).toFixed(3)}</span>}
        </span>
      )}

      {/* Primary action button */}
      {status === "running" && (
        <Loader2 className="h-4 w-4 text-primary animate-spin" />
      )}
      {status === "failed" && !running && (
        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={(e) => { e.stopPropagation(); onRetry(def.id); }}>
          <RefreshCw className="h-3 w-3 mr-1" /> Retry
        </Button>
      )}
      {!running && status === "completed" && (
        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={(e) => { e.stopPropagation(); onRunSingle(def.id); }}>
          <RefreshCw className="h-3 w-3" />
        </Button>
      )}
      {!running && canRunSingle && status !== "completed" && status !== "failed" && status !== "running" && (
        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={(e) => { e.stopPropagation(); onRunSingle(def.id); }}>
          <Play className="h-3 w-3 mr-1" /> Run
        </Button>
      )}

      {/* Status badge */}
      <Badge variant={statusVariant(status)} className="text-xs">
        {status}
      </Badge>

      {/* Modified indicator */}
      {isModified && (
        <Badge variant="outline" className="text-xs border-amber-500/50 text-amber-500">mod</Badge>
      )}

      {/* Overflow menu — only for completed/failed/skipped steps */}
      {!running && (status === "completed" || status === "failed" || status === "skipped") && (
        <DropdownMenu
          trigger={
            <button className="p-1 rounded hover:bg-muted-foreground/10 transition-colors text-muted-foreground">
              <MoreHorizontal className="h-4 w-4" />
            </button>
          }
        >
          {status === "completed" && (
            <DropdownItem onClick={() => onRunFrom(def.id)}>
              <FastForward className="h-3 w-3" /> Run from here
            </DropdownItem>
          )}
          {status === "completed" && (
            <DropdownItem onClick={() => onRunSingle(def.id)}>
              <RefreshCw className="h-3 w-3" /> Re-run this step
            </DropdownItem>
          )}
          {status === "failed" && (
            <DropdownItem onClick={() => onRetry(def.id)}>
              <RefreshCw className="h-3 w-3" /> Retry
            </DropdownItem>
          )}

          <DropdownSeparator />

          <DropdownLabel>Export</DropdownLabel>
          <DropdownItem onClick={() => window.open(`/api/export?project_id=${projectId}&steps=${def.id}&format=md`, '_blank')}>
            <Download className="h-3 w-3" /> Markdown
          </DropdownItem>
          <DropdownItem onClick={() => window.open(`/api/export?project_id=${projectId}&steps=${def.id}&format=txt`, '_blank')}>
            <Download className="h-3 w-3" /> Text
          </DropdownItem>
          <DropdownItem onClick={() => window.open(`/api/export?project_id=${projectId}&steps=${def.id}&format=json`, '_blank')}>
            <Download className="h-3 w-3" /> JSON
          </DropdownItem>

          {(hasDuration || hasCost) && (
            <>
              <DropdownSeparator />
              <DropdownLabel>Info</DropdownLabel>
              {hasDuration && (
                <div className="px-3 py-1 text-xs text-muted-foreground">
                  Duration: {(stepData!.duration_ms! / 1000).toFixed(1)}s
                </div>
              )}
              {hasCost && (
                <div className="px-3 py-1 text-xs text-muted-foreground">
                  Cost: ${(stepData!.cost_cents! / 100).toFixed(3)}
                </div>
              )}
            </>
          )}
        </DropdownMenu>
      )}
    </div>
  );
}
