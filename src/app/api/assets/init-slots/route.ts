/**
 * POST /api/assets/init-slots — Manually trigger asset slot initialization.
 * Used for projects where visual_direction completed before the slot init code was deployed.
 */
import { NextResponse } from "next/server";
import { getStepsByProject } from "@/lib/store";
import { initializeAssetSlots } from "@/lib/pipeline/initialize-asset-slots";

export async function POST(request: Request) {
  try {
    const { project_id } = await request.json();

    if (!project_id) {
      return NextResponse.json(
        { success: false, error: "Missing project_id" },
        { status: 400 },
      );
    }

    const steps = await getStepsByProject(project_id);
    const vdStep = steps.find(s => s.step === "visual_direction" && s.status === "completed");
    if (!vdStep) {
      return NextResponse.json(
        { success: false, error: "visual_direction must be completed first" },
        { status: 400 },
      );
    }

    const visuals = (vdStep.output as { visuals?: string })?.visuals || "";
    if (!visuals) {
      return NextResponse.json(
        { success: false, error: "visual_direction output has no visuals data" },
        { status: 400 },
      );
    }

    await initializeAssetSlots(project_id, visuals);

    // Read back what was created for the summary
    const updatedSteps = await getStepsByProject(project_id);
    const imgScenes = ((updatedSteps.find(s => s.step === "image_generation")?.output as Record<string, unknown>)?.scenes as unknown[] || []).length;
    const heroScenes = ((updatedSteps.find(s => s.step === "hero_scenes")?.output as Record<string, unknown>)?.scenes as unknown[] || []).length;
    const stockSlots = ((updatedSteps.find(s => s.step === "stock_footage")?.output as Record<string, unknown>)?.footage as unknown[] || []).length;

    const summary = `${imgScenes} DALL-E, ${heroScenes} Runway, ${stockSlots} Stock slots`;

    return NextResponse.json({
      success: true,
      data: { summary, image_scenes: imgScenes, hero_scenes: heroScenes, stock_slots: stockSlots },
    });
  } catch (error) {
    console.error("[assets/init-slots]", error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 },
    );
  }
}
