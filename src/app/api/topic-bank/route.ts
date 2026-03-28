import { NextResponse } from "next/server";
import { create, getByField } from "@/lib/store";
import type { TopicBankItem, TopicSuggestion } from "@/types";

// GET /api/topic-bank?profile_id=xxx&status=available
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const profileId = searchParams.get("profile_id");

    if (!profileId) {
      return NextResponse.json({ success: false, error: "profile_id is required" }, { status: 400 });
    }

    let topics = await getByField<TopicBankItem>("topic_bank", "profile_id", profileId);

    const status = searchParams.get("status");
    if (status) {
      topics = topics.filter(t => t.status === status);
    }

    return NextResponse.json({ success: true, data: topics });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

// POST /api/topic-bank — bulk-save topics
export async function POST(request: Request) {
  try {
    const { profile_id, topics } = await request.json() as {
      profile_id: string;
      topics: TopicSuggestion[];
    };

    if (!profile_id || !topics?.length) {
      return NextResponse.json({ success: false, error: "profile_id and topics[] required" }, { status: 400 });
    }

    const created: TopicBankItem[] = [];
    for (const topic of topics) {
      const item = await create<TopicBankItem>("topic_bank", {
        profile_id,
        title: topic.title,
        angle: topic.angle,
        keywords: topic.keywords,
        estimated_interest: topic.estimated_interest,
        reasoning: topic.reasoning,
        status: "available",
      } as Omit<TopicBankItem, "id" | "created_at" | "updated_at">);
      created.push(item);
    }

    return NextResponse.json({ success: true, data: created });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
