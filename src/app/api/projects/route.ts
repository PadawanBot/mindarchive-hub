import { NextResponse } from "next/server";
import { getAll, create } from "@/lib/store";
import type { Project } from "@/types";

export async function GET() {
  try {
    const projects = await getAll<Project>("projects");
    return NextResponse.json({ success: true, data: projects });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const project = await create<Project>("projects", {
      title: body.title,
      topic: body.topic,
      profile_id: body.profile_id,
      format_id: body.format_id,
      status: "draft",
      total_cost_cents: 0,
      topic_data: body.topic_data || null,
      script_data: null,
      visual_data: null,
      metadata: { additional_notes: body.additional_notes || "" },
    } as Omit<Project, "id" | "created_at" | "updated_at">);
    return NextResponse.json({ success: true, data: project });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
