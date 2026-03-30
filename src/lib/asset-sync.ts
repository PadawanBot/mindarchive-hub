/**
 * Auto-sync asset records after a step completes.
 * Scans the step output for known asset URL patterns and upserts records.
 * This ensures the assets table stays in sync without manual backfill.
 */
import { upsertAssetRecord } from "@/lib/asset-db";
import { getSlotsForStep } from "@/lib/asset-validation";
import { parseSlotKey, getNestedValue } from "@/lib/asset-patch";

function guessMime(url: string): string {
  const lower = url.toLowerCase();
  if (lower.match(/\.(png)(\?|$)/)) return "image/png";
  if (lower.match(/\.(jpe?g)(\?|$)/)) return "image/jpeg";
  if (lower.match(/\.(webp)(\?|$)/)) return "image/webp";
  if (lower.match(/\.(mp3)(\?|$)/)) return "audio/mpeg";
  if (lower.match(/\.(wav)(\?|$)/)) return "audio/wav";
  if (lower.match(/\.(mp4)(\?|$)/)) return "video/mp4";
  if (lower.match(/\.(webm)(\?|$)/)) return "video/webm";
  return "application/octet-stream";
}

function cleanFilename(url: string, fallback: string): string {
  try {
    const pathname = new URL(url).pathname;
    return decodeURIComponent(pathname.split("/").pop() || fallback);
  } catch {
    return fallback;
  }
}

function storagePath(url: string, fallback: string): string {
  const match = url.match(/project-assets\/(.+?)(\?|$)/);
  return match ? match[1] : fallback;
}

interface FoundAsset {
  slotKey: string;
  url: string;
}

/**
 * Scan step output for asset URLs using slot definitions + known output patterns.
 */
function findAssets(step: string, output: Record<string, unknown>): FoundAsset[] {
  const found: FoundAsset[] = [];
  const seen = new Set<string>();

  // 1. Slot-based scanning
  const slots = getSlotsForStep(step);
  for (const slotDef of slots) {
    const path = parseSlotKey(slotDef.slotKey);
    const val = getNestedValue(output, path);
    if (typeof val === "string" && val.startsWith("http") && !seen.has(slotDef.slotKey)) {
      found.push({ slotKey: slotDef.slotKey, url: val });
      seen.add(slotDef.slotKey);
    }
  }

  // 2. Direct output scanning for known structures
  if (step === "voiceover_generation" && typeof output.audio_url === "string" && !seen.has("audio_url")) {
    found.push({ slotKey: "audio_url", url: output.audio_url });
  }

  if (step === "image_generation") {
    // New format: scenes[] with image_url
    if (Array.isArray(output.scenes)) {
      output.scenes.forEach((scene, i) => {
        const key = `scenes[${i}].image_url`;
        const sceneObj = scene as Record<string, unknown>;
        if (typeof sceneObj?.image_url === "string" && !seen.has(key)) {
          found.push({ slotKey: key, url: sceneObj.image_url as string });
        }
      });
    }
    // Legacy format: images[] with url
    if (Array.isArray(output.images)) {
      output.images.forEach((img, i) => {
        const key = `images[${i}].url`;
        const imgObj = img as Record<string, unknown>;
        if (typeof imgObj?.url === "string" && !seen.has(key)) {
          found.push({ slotKey: key, url: imgObj.url as string });
        }
      });
    }
  }

  if (step === "hero_scenes" && Array.isArray(output.scenes)) {
    output.scenes.forEach((scene, i) => {
      const key = `scenes[${i}].video_url`;
      const sceneObj = scene as Record<string, unknown>;
      if (typeof sceneObj?.video_url === "string" && !seen.has(key)) {
        found.push({ slotKey: key, url: sceneObj.video_url as string });
      }
    });
  }

  if (step === "stock_footage" && Array.isArray(output.footage)) {
    let clipIdx = 0;
    for (const group of output.footage as Record<string, unknown>[]) {
      if (Array.isArray(group?.videos)) {
        for (const v of group.videos as Record<string, unknown>[]) {
          const key = `stock_clips[${clipIdx}].url`;
          const fileUrl = (typeof v?.file_url === "string" ? v.file_url : null)
            || (typeof v?.thumbnail === "string" ? v.thumbnail : null)
            || (typeof v?.url === "string" ? v.url : null);
          if (fileUrl && clipIdx < 5 && !seen.has(key)) {
            found.push({ slotKey: key, url: fileUrl });
            clipIdx++;
          }
        }
      }
    }
  }

  return found;
}

/**
 * Auto-register asset records for a completed step.
 * Call this after saving step output. Best-effort — errors are logged but don't fail the step.
 */
export async function syncStepAssets(projectId: string, step: string, output: Record<string, unknown>): Promise<void> {
  try {
    const assets = findAssets(step, output);
    for (const asset of assets) {
      const filename = cleanFilename(asset.url, `${step}_${asset.slotKey}`);
      await upsertAssetRecord({
        projectId,
        step,
        slotKey: asset.slotKey,
        filename,
        storagePath: storagePath(asset.url, `${projectId}/${filename}`),
        mimeType: guessMime(asset.url),
        sizeBytes: 0,
        url: asset.url,
        source: "generated",
      });
    }
  } catch (err) {
    console.error(`[asset-sync] Failed to sync assets for ${step}:`, err);
  }
}
