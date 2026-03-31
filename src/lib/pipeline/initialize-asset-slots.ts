/**
 * Initialize empty step outputs for all downstream asset steps after visual_direction completes.
 *
 * This creates the correct scene arrays (with scene_id, label, prompt, status: "pending")
 * so that manual uploads from the assets page can go directly into the right slot
 * WITHOUT needing pooling or reconciliation.
 *
 * Called from save/route.ts and llm-callback/route.ts when visual_direction completes.
 */

import { upsertStep, getStepsByProject } from "@/lib/store";
import { parseDalleScenes, parseRunwayScenes, parseStockScenes } from "@/lib/pipeline/parse-visual-scenes";

/**
 * After visual_direction completes, pre-create step outputs for:
 * - image_generation: scenes[] with DALL-E prompts
 * - hero_scenes: scenes[] with Runway prompts
 * - stock_footage: footage[] with STOCK queries
 *
 * Only initializes steps that don't already have output (won't overwrite completed steps).
 */
export async function initializeAssetSlots(projectId: string, visualsRaw: string): Promise<void> {
  const existingSteps = await getStepsByProject(projectId);
  const now = new Date().toISOString();

  // ── Image Generation (DALL-E) ──
  const imageStep = existingSteps.find(s => s.step === "image_generation");
  if (!imageStep || imageStep.status === "pending" || !imageStep.output) {
    const dalleScenes = parseDalleScenes(visualsRaw);
    if (dalleScenes.length > 0) {
      await upsertStep(projectId, "image_generation", {
        status: "pending",
        output: {
          scenes: dalleScenes,
          total_prompts: dalleScenes.length,
          generated: 0,
          status: "awaiting_assets",
        },
        modified_at: now,
      } as Record<string, unknown>);
      console.log(`[init-slots] image_generation: ${dalleScenes.length} DALL-E scene slots created`);
    }
  }

  // ── Hero Scenes (Runway) ──
  const heroStep = existingSteps.find(s => s.step === "hero_scenes");
  if (!heroStep || heroStep.status === "pending" || !heroStep.output) {
    const runwayScenes = parseRunwayScenes(visualsRaw);
    if (runwayScenes.length > 0) {
      await upsertStep(projectId, "hero_scenes", {
        status: "pending",
        output: {
          scenes: runwayScenes,
          total_requested: runwayScenes.length,
          status: "awaiting_assets",
        },
        modified_at: now,
      } as Record<string, unknown>);
      console.log(`[init-slots] hero_scenes: ${runwayScenes.length} Runway scene slots created`);
    }
  }

  // ── Stock Footage ──
  const stockStep = existingSteps.find(s => s.step === "stock_footage");
  if (!stockStep || stockStep.status === "pending" || !stockStep.output) {
    const stockScenes = parseStockScenes(visualsRaw);
    if (stockScenes.length > 0) {
      await upsertStep(projectId, "stock_footage", {
        status: "pending",
        output: {
          footage: stockScenes.map(s => ({
            scene_id: s.scene_id,
            query: s.query,
            label: s.label,
            videos: [],
          })),
          total_queries: stockScenes.length,
          status: "awaiting_assets",
        },
        modified_at: now,
      } as Record<string, unknown>);
      console.log(`[init-slots] stock_footage: ${stockScenes.length} stock scene slots created`);
    }
  }

  console.log(`[init-slots] Asset slots initialized for project ${projectId}`);
}
