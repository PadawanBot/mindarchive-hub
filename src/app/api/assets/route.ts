/**
 * GET /api/assets?project_id=xxx — List all assets for a project.
 */
import { NextResponse } from "next/server";
import { listProjectAssets } from "@/lib/asset-db";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("project_id");

  if (!projectId) {
    return NextResponse.json(
      { success: false, error: "project_id is required" },
      { status: 400 }
    );
  }

  const assets = await listProjectAssets(projectId);

  // Group by step
  const grouped: Record<string, typeof assets> = {};
  for (const asset of assets) {
    const key = asset.step || "unassigned";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(asset);
  }

  return NextResponse.json({ success: true, data: { assets, grouped } });
}
