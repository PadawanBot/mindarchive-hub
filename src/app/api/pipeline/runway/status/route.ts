import { NextResponse } from "next/server";
import { getSetting } from "@/lib/store";
import { checkTaskStatus } from "@/lib/providers/runway";

export const maxDuration = 15;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get("task_id");

    if (!taskId) {
      return NextResponse.json(
        { success: false, error: "Missing task_id query parameter" },
        { status: 400 }
      );
    }

    const apiKey = await getSetting("runway_key");
    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: "Runway API key not configured. Go to Settings." },
        { status: 400 }
      );
    }

    const result = await checkTaskStatus(apiKey, taskId);

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
