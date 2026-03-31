/**
 * Reconcile pooled (pre-visual-direction) assets against parsed scene definitions.
 *
 * Pooled assets are uploaded before visual_direction runs, so they have no scene_id.
 * After visual_direction completes and scenes are parsed, this module matches pooled
 * assets to pending scenes by upload order (first uploaded → first pending scene).
 *
 * The caller is responsible for writing matched URLs into step output.
 */

import type { AssetRow } from "@/lib/asset-db";
import { updateAssetSlotKey } from "@/lib/asset-db";

export interface ReconcileMatch {
  assetId: string;
  sceneId: number;
  sceneIndex: number;
  url: string;
}

export interface ReconcileResult {
  matched: ReconcileMatch[];
  unmatched: string[]; // asset IDs with no available scene
}

interface SceneBase {
  scene_id: number;
  image_url?: string | null;
  video_url?: string | null;
  status: string;
}

/**
 * Match pooled assets to pending scenes by position (upload order → scene order).
 * Updates each matched asset's slot_key from __pool__* to the canonical key.
 *
 * @param projectId - Project ID (for logging)
 * @param step - Pipeline step name ("image_generation" or "hero_scenes")
 * @param scenes - Parsed scene definitions from visual direction
 * @param pooledAssets - Pooled asset records (ordered by created_at ASC)
 * @returns Which assets were matched and which remain unmatched
 */
export async function reconcilePooledAssets(
  projectId: string,
  step: string,
  scenes: SceneBase[],
  pooledAssets: AssetRow[],
): Promise<ReconcileResult> {
  const urlField = step === "hero_scenes" ? "video_url" : "image_url";
  const matched: ReconcileMatch[] = [];
  const unmatched: string[] = [];

  // Identify pending scenes (no completed URL yet)
  const pendingScenes = scenes
    .map((s, idx) => ({ ...s, _idx: idx }))
    .filter(s => {
      const url = urlField === "video_url" ? s.video_url : s.image_url;
      return s.status !== "completed" || !url;
    });

  // Match by position: first pooled asset → first pending scene
  for (let i = 0; i < pooledAssets.length; i++) {
    const asset = pooledAssets[i];
    if (i < pendingScenes.length) {
      const scene = pendingScenes[i];
      const canonicalSlotKey = `scenes[${scene._idx}].${urlField}`;

      // Update the asset record's slot_key to the canonical scene key
      const updated = await updateAssetSlotKey(asset.id, canonicalSlotKey);
      if (!updated) {
        console.warn(`[reconcile] Failed to update slot_key for asset ${asset.id}`);
      }

      matched.push({
        assetId: asset.id,
        sceneId: scene.scene_id,
        sceneIndex: scene._idx,
        url: asset.url || "",
      });

      console.log(`[reconcile] ${step}: asset ${asset.id} → scene_id ${scene.scene_id} (index ${scene._idx})`);
    } else {
      unmatched.push(asset.id);
    }
  }

  console.log(`[reconcile] ${step} for project ${projectId}: ${matched.length} matched, ${unmatched.length} unmatched`);
  return { matched, unmatched };
}
