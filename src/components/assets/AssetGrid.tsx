"use client";

import { useMemo } from "react";
import { AssetSlot } from "./AssetSlot";
import { getSlotsForStep } from "@/lib/asset-validation";
import { parseSlotKey, getNestedValue } from "@/lib/asset-patch";
import type { PipelineStep } from "@/types";

interface AssetGridProps {
  projectId: string;
  step: PipelineStep;
  output: Record<string, unknown>;
  onOutputChanged: () => void;
}

/**
 * Renders a grid of AssetSlots for a pipeline step.
 * Reads slot definitions to determine how many slots exist,
 * then maps the current step output to populate them.
 */
export function AssetGrid({ projectId, step, output, onOutputChanged }: AssetGridProps) {
  const slotDefs = useMemo(() => getSlotsForStep(step), [step]);

  if (slotDefs.length === 0) return null;

  // Determine columns based on slot count
  const cols = slotDefs.length === 1 ? "grid-cols-1"
    : slotDefs.length === 2 ? "grid-cols-1 sm:grid-cols-2"
    : "grid-cols-1 sm:grid-cols-2 md:grid-cols-3";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Asset Slots
        </span>
        <span className="text-xs text-muted-foreground">
          {slotDefs.filter((s) => {
            const path = parseSlotKey(s.slotKey);
            return getNestedValue(output, path) != null;
          }).length} / {slotDefs.length} filled
        </span>
      </div>
      <div className={`grid ${cols} gap-3`}>
        {slotDefs.map((slotDef) => {
          const path = parseSlotKey(slotDef.slotKey);
          const currentUrl = getNestedValue(output, path) as string | null;

          return (
            <AssetSlot
              key={slotDef.slotKey}
              projectId={projectId}
              slotDef={slotDef}
              currentUrl={currentUrl || null}
              onAssetChanged={onOutputChanged}
            />
          );
        })}
      </div>
    </div>
  );
}
