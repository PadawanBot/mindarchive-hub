import { NextResponse } from "next/server";
import { getAll, create, update } from "@/lib/store";
import type { Project, TopicBankItem } from "@/types";

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
      metadata: {
        additional_notes: body.additional_notes || "",
        ...(body.topic_bank_id ? { topic_bank_id: body.topic_bank_id } : {}),
      },
    } as Omit<Project, "id" | "created_at" | "updated_at">);

    // Mark topic as in_production in the bank
    if (body.topic_bank_id) {
      try {
        await update<TopicBankItem>("topic_bank", body.topic_bank_id, {
          status: "in_production",
          project_id: project.id,
        } as Partial<TopicBankItem>);
      } catch (err) {
        console.error("[projects] Failed to update topic bank status:", err);
      }
    }

    return NextResponse.json({ success: true, data: project });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
