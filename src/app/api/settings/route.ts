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

export async function POST(request: Request) {
  try {
    const text = await request.text();
    if (!text) {
      return NextResponse.json({ success: false, error: "Empty request body" }, { status: 400 });
    }
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text);
    } catch {
      return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
    }
    const errors: string[] = [];
    const saved: string[] = [];
    for (const [key, value] of Object.entries(body)) {
      if (typeof value === "string" && !value.includes("****")) {
        try {
          await setSetting(key, value);
          saved.push(key);
        } catch (err) {
          errors.push(`${key}: ${String(err)}`);
        }
      }
    }
    if (errors.length > 0) {
      return NextResponse.json(
        { success: false, error: errors.join("; "), saved },
        { status: 500 }
      );
    }
    return NextResponse.json({ success: true, saved });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: `Unhandled: ${String(error)}` },
      { status: 500 }
    );
  }
}
