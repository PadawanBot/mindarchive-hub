import { NextResponse } from "next/server";
import { getAll, create } from "@/lib/store";
import type { ChannelProfile } from "@/types";

export async function GET() {
  try {
    const profiles = await getAll<ChannelProfile>("profiles");
    return NextResponse.json({ success: true, data: profiles });
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
    const profile = await create<ChannelProfile>("profiles", {
      ...body,
      brand_colors: body.brand_colors || [],
    });
    return NextResponse.json({ success: true, data: profile });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
