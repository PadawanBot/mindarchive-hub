/**
 * POST /api/assets/backfill — Scan existing step outputs and register assets in the DB.
 * Run once to populate the assets table for projects created before asset management.
 */
import { NextResponse } from "next/server";
import { getSlotsForStep } from "@/lib/asset-validation";
import { parseSlotKey, getNestedValue } from "@/lib/asset-patch";
import { upsertAssetRecord } from "@/lib/asset-db";
import { getStepsByProject } from "@/lib/store";

export async function POST(request: Request) {
  try {
    const { project_id } = await request.json();
    if (!project_id) {
      return NextResponse.json({ success: false, error: "project_id required" }, { status: 400 });
    }

    const steps = await getStepsByProject(project_id);
    let registered = 0;
    let skipped = 0;

    for (const step of steps) {
      if (!step.output) continue;
      const slots = getSlotsForStep(step.step);

      for (const slotDef of slots) {
        const path = parseSlotKey(slotDef.slotKey);
        const url = getNestedValue(step.output as Record<string, unknown>, path);

        if (typeof url === "string" && url.startsWith("http")) {
          // Derive filename from URL or slot key
          const urlParts = url.split("/");
          const filename = urlParts[urlParts.length - 1] || `${step.step}_${slotDef.slotKey}`;

          // Guess mime type from URL/extension
          let mimeType = "application/octet-stream";
          if (url.match(/\.(png|jpg|jpeg|webp)(\?|$)/i)) mimeType = "image/" + (url.match(/\.(png|jpg|jpeg|webp)/i)?.[1] || "png");
          else if (url.match(/\.(mp3|wav)(\?|$)/i)) mimeType = "audio/" + (url.match(/\.(mp3|wav)/i)?.[1] || "mpeg");
          else if (url.match(/\.(mp4|webm|mov)(\?|$)/i)) mimeType = "video/" + (url.match(/\.(mp4|webm|mov)/i)?.[1] || "mp4");

          // Derive storage path from URL (extract the project-assets/... part)
          const storageMatch = url.match(/project-assets\/(.+?)(\?|$)/);
          const storagePath = storageMatch ? storageMatch[1] : `${project_id}/${filename}`;

          await upsertAssetRecord({
            projectId: project_id,
            step: step.step,
            slotKey: slotDef.slotKey,
            filename,
            storagePath,
            mimeType,
            sizeBytes: 0, // Unknown for existing assets
            url,
            source: "generated",
          });
          registered++;
        } else {
          skipped++;
        }
      }
    }

    return NextResponse.json({
      success: true,
      data: { registered, skipped },
    });
  } catch (error) {
    console.error("[assets/backfill]", error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
