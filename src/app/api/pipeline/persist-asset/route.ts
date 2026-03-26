import { NextResponse } from "next/server";
import { downloadAndStore } from "@/lib/storage";

export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const { project_id, filename, source_url, mime_type } = await request.json();
    const storedUrl = await downloadAndStore(project_id, filename, source_url, mime_type || "video/mp4");
    if (!storedUrl) {
      return NextResponse.json({ success: false, error: "Failed to download and store asset" }, { status: 500 });
    }
    return NextResponse.json({ success: true, data: { url: storedUrl } });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
