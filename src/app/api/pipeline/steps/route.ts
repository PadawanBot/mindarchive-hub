import { NextResponse } from "next/server";
import { getStepsByProject } from "@/lib/store";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("project_id");
    if (!projectId) {
      return NextResponse.json({ success: false, error: "project_id required" }, { status: 400 });
    }
    const steps = await getStepsByProject(projectId);
    return NextResponse.json({ success: true, data: steps });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
