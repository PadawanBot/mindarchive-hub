/**
 * POST /api/assets/backfill — Scan existing step outputs and register assets in the DB.
 * Handles all known output structures including slot-key paths AND direct output scanning.
 */
import { NextResponse } from "next/server";
import { getSlotsForStep } from "@/lib/asset-validation";
import { parseSlotKey, getNestedValue } from "@/lib/asset-patch";
import { upsertAssetRecord } from "@/lib/asset-db";
import { getStepsByProject } from "@/lib/store";

/** Extract a clean filename from a URL (strip query params and decode) */
function cleanFilename(url: string, fallback: string): string {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const lastSegment = pathname.split("/").pop() || fallback;
    return decodeURIComponent(lastSegment);
  } catch {
    return fallback;
  }
}

/** Guess mime type from URL */
function guessMime(url: string): string {
  const lower = url.toLowerCase();
  if (lower.match(/\.(png)(\?|$)/)) return "image/png";
  if (lower.match(/\.(jpe?g)(\?|$)/)) return "image/jpeg";
  if (lower.match(/\.(webp)(\?|$)/)) return "image/webp";
  if (lower.match(/\.(mp3)(\?|$)/)) return "audio/mpeg";
  if (lower.match(/\.(wav)(\?|$)/)) return "audio/wav";
  if (lower.match(/\.(mp4)(\?|$)/)) return "video/mp4";
  if (lower.match(/\.(webm)(\?|$)/)) return "video/webm";
  if (lower.match(/\.(mov)(\?|$)/)) return "video/quicktime";
  return "application/octet-stream";
}

/** Derive storage path from Supabase URL */
function storagePath(url: string, fallback: string): string {
  const match = url.match(/project-assets\/(.+?)(\?|$)/);
  return match ? match[1] : fallback;
}

interface FoundAsset {
  step: string;
  slotKey: string;
  url: string;
  label: string;
}

/** Scan a step output for asset URLs that match slot definitions */
function scanSlotAssets(
  step: string,
  output: Record<string, unknown>,
): FoundAsset[] {
  const found: FoundAsset[] = [];
  const slots = getSlotsForStep(step);

  for (const slotDef of slots) {
    const path = parseSlotKey(slotDef.slotKey);
    const val = getNestedValue(output, path);
    if (typeof val === "string" && val.startsWith("http")) {
      found.push({ step, slotKey: slotDef.slotKey, url: val, label: slotDef.label });
    }
  }

  return found;
}

/** Direct output scanning for known structures that don't match slot keys */
function scanDirectAssets(
  step: string,
  output: Record<string, unknown>,
): FoundAsset[] {
  const found: FoundAsset[] = [];

  // Voiceover: output.audio_url
  if (step === "voiceover_generation" && typeof output.audio_url === "string") {
    found.push({
      step,
      slotKey: "audio_url",
      url: output.audio_url,
      label: "Voiceover MP3",
    });
  }

  // Images: output.images[].url
  if (step === "image_generation" && Array.isArray(output.images)) {
    output.images.forEach((img, i) => {
      const imgObj = img as Record<string, unknown>;
      if (typeof imgObj?.url === "string") {
        found.push({
          step,
          slotKey: `images[${i}].url`,
          url: imgObj.url as string,
          label: `Scene ${i + 1} Image`,
        });
      }
    });
  }

  // Hero scenes: output.scenes[].video_url
  if (step === "hero_scenes" && Array.isArray(output.scenes)) {
    output.scenes.forEach((scene, i) => {
      const sceneObj = scene as Record<string, unknown>;
      if (typeof sceneObj?.video_url === "string") {
        found.push({
          step,
          slotKey: `scenes[${i}].video_url`,
          url: sceneObj.video_url as string,
          label: `Hero Scene ${i + 1}`,
        });
      }
    });
  }

  // Stock footage: output.footage[].videos[].url (complex nested)
  if (step === "stock_footage" && Array.isArray(output.footage)) {
    let clipIndex = 0;
    output.footage.forEach((group) => {
      const groupObj = group as Record<string, unknown>;
      if (Array.isArray(groupObj?.videos)) {
        groupObj.videos.forEach((v) => {
          const vid = v as Record<string, unknown>;
          if (typeof vid?.url === "string" && clipIndex < 5) {
            found.push({
              step,
              slotKey: `stock_clips[${clipIndex}].url`,
              url: vid.url as string,
              label: `Stock Clip ${clipIndex + 1}`,
            });
            clipIndex++;
          }
        });
      }
    });
  }

  return found;
}

export async function POST(request: Request) {
  try {
    const { project_id } = await request.json();
    if (!project_id) {
      return NextResponse.json({ success: false, error: "project_id required" }, { status: 400 });
    }

    const steps = await getStepsByProject(project_id);
    let registered = 0;
    const details: { step: string; slotKey: string; label: string }[] = [];

    for (const step of steps) {
      if (!step.output) continue;
      const output = step.output as Record<string, unknown>;

      // Merge slot-based scanning + direct scanning, dedup by slotKey
      const slotAssets = scanSlotAssets(step.step, output);
      const directAssets = scanDirectAssets(step.step, output);

      const seen = new Set<string>();
      const allAssets = [...slotAssets, ...directAssets].filter((a) => {
        const key = `${a.step}:${a.slotKey}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      for (const asset of allAssets) {
        const filename = cleanFilename(asset.url, `${asset.step}_${asset.slotKey}`);
        const mime = guessMime(asset.url);
        const spath = storagePath(asset.url, `${project_id}/${filename}`);

        await upsertAssetRecord({
          projectId: project_id,
          step: asset.step,
          slotKey: asset.slotKey,
          filename,
          storagePath: spath,
          mimeType: mime,
          sizeBytes: 0,
          url: asset.url,
          source: "generated",
        });
        registered++;
        details.push({ step: asset.step, slotKey: asset.slotKey, label: asset.label });
      }
    }

    return NextResponse.json({
      success: true,
      data: { registered, details },
    });
  } catch (error) {
    console.error("[assets/backfill]", error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
