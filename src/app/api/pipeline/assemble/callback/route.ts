import { NextResponse } from "next/server";
import { getById, update } from "@/lib/store";
import type { Project } from "@/types";

export async function POST(request: Request) {
  try {
    const { projectId, status, outputUrl, durationSeconds, fileSizeBytes, error } = await request.json();

    const project = await getById<Project>("projects", projectId);
    if (!project) {
      return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });
    }

    if (status === "completed" && outputUrl) {
      await update<Project>("projects", projectId, {
        output_url: outputUrl,
        metadata: {
          ...((project.metadata as Record<string, unknown>) || {}),
          assembly_status: "completed",
          assembly_duration_seconds: durationSeconds,
          assembly_file_size_bytes: fileSizeBytes,
          assembly_completed_at: new Date().toISOString(),
        },
      } as Partial<Project>);
    } else {
      await update<Project>("projects", projectId, {
        metadata: {
          ...((project.metadata as Record<string, unknown>) || {}),
          assembly_status: "failed",
          assembly_error: error || "Unknown error",
          assembly_failed_at: new Date().toISOString(),
        },
      } as Partial<Project>);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
