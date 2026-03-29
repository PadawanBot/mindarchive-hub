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

    // Link to topic bank
    if (body.topic_bank_id) {
      // Created from an existing topic bank entry — mark it in_production
      try {
        await update<TopicBankItem>("topic_bank", body.topic_bank_id, {
          status: "in_production",
          project_id: project.id,
        } as Partial<TopicBankItem>);
      } catch (err) {
        console.error("[projects] Failed to update topic bank status:", err);
      }
    } else if (body.profile_id && body.topic) {
      // Created directly — auto-create a topic bank entry so the topic is tracked
      try {
        await create<TopicBankItem>("topic_bank", {
          profile_id: body.profile_id,
          title: body.topic,
          angle: "",
          keywords: [],
          estimated_interest: "medium",
          reasoning: "Added automatically when project was created.",
          status: "in_production",
          project_id: project.id,
        } as Omit<TopicBankItem, "id" | "created_at" | "updated_at">);
      } catch (err) {
        console.error("[projects] Failed to auto-create topic bank entry:", err);
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
