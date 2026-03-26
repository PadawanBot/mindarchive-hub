/**
 * DELETE /api/assets/[id] — Delete any asset (manual or generated).
 * Removes from storage, DB, and nullifies the step output field.
 */
import { NextResponse } from "next/server";
import { getAssetById, deleteAsset } from "@/lib/asset-db";
import { patchStepOutput } from "@/lib/asset-patch";
import { getStepsByProject, upsertStep } from "@/lib/store";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const asset = await getAssetById(id);
    if (!asset) {
      return NextResponse.json(
        { success: false, error: "Asset not found" },
        { status: 404 }
      );
    }

    // Clear the step output field
    if (asset.project_id && asset.step && asset.slot_key) {
      const steps = await getStepsByProject(asset.project_id);
      const existing = steps.find((s) => s.step === asset.step);
      if (existing?.output) {
        const patchedOutput = patchStepOutput(
          existing.output as Record<string, unknown>,
          asset.slot_key,
          null
        );
        await upsertStep(asset.project_id, asset.step, {
          output: patchedOutput,
          modified_at: new Date().toISOString(),
        } as Record<string, unknown>);
      }
    }

    // Delete from storage and DB
    const deleted = await deleteAsset(id);
    if (!deleted) {
      return NextResponse.json(
        { success: false, error: "Failed to delete asset" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[assets/delete]", error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
