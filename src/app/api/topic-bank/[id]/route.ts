import { NextResponse } from "next/server";
import { getById, update, remove } from "@/lib/store";
import type { TopicBankItem } from "@/types";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const topic = await getById<TopicBankItem>("topic_bank", id);
    if (!topic) {
      return NextResponse.json({ success: false, error: "Topic not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: topic });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const updated = await update<TopicBankItem>("topic_bank", id, body);
    if (!updated) {
      return NextResponse.json({ success: false, error: "Topic not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const deleted = await remove<TopicBankItem>("topic_bank", id);
    if (!deleted) {
      return NextResponse.json({ success: false, error: "Topic not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
