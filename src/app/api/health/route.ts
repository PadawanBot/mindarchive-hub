import { NextResponse } from "next/server";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const hasSecret = !!process.env.SUPABASE_SECRET_KEY;
  const hasServiceRole = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  const hasPublishable = !!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const hasAnon = !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  let dbStatus = "not configured";
  if (url && (hasSecret || hasServiceRole || hasPublishable || hasAnon)) {
    try {
      const { createClient } = await import("@supabase/supabase-js");
      const key = process.env.SUPABASE_SECRET_KEY
        || process.env.SUPABASE_SERVICE_ROLE_KEY
        || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
        || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      const sb = createClient(url, key!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { data, error } = await sb.from("settings").select("count").limit(1);
      dbStatus = error ? `error: ${error.message}` : "connected";
    } catch (err) {
      dbStatus = `crash: ${String(err)}`;
    }
  }

  return NextResponse.json({
    status: "ok",
    supabase: {
      url: url ? url.substring(0, 30) + "..." : null,
      hasSecret,
      hasServiceRole,
      hasPublishable,
      hasAnon,
      dbStatus,
    },
  });
}
