import { NextResponse } from "next/server";
import { getAllSettings, setSetting } from "@/lib/store";

export async function GET() {
  try {
    const settings = await getAllSettings();
    // Mask API keys for GET responses
    const masked: Record<string, string> = {};
    for (const [key, value] of Object.entries(settings)) {
      if (key.endsWith("_key") && value.length > 8) {
        masked[key] = value.slice(0, 6) + "****" + value.slice(-4);
      } else {
        masked[key] = value;
      }
    }
    return NextResponse.json({ success: true, data: masked });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    for (const [key, value] of Object.entries(body)) {
      if (typeof value === "string" && !value.includes("****")) {
        await setSetting(key, value);
      }
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
