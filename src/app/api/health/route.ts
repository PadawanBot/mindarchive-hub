import { NextResponse } from "next/server";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const hasSecret = !!process.env.SUPABASE_SECRET_KEY;
  const hasServiceRole = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  const hasPublishable = !!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const hasAnon = !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  let dbRead = "not configured";
  let dbWrite = "not tested";
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

      // Test read
      const { error: readErr } = await sb.from("settings").select("key").limit(1);
      dbRead = readErr ? `error: ${readErr.message} (code: ${readErr.code})` : "ok";

      // Test write (upsert)
      const { error: writeErr } = await sb
        .from("settings")
        .upsert(
          { key: "_health_check", value: new Date().toISOString(), updated_at: new Date().toISOString() },
          { onConflict: "key" }
        );
      dbWrite = writeErr ? `error: ${writeErr.message} (code: ${writeErr.code})` : "ok";
    } catch (err) {
      dbRead = `crash: ${String(err)}`;
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
      dbRead,
      dbWrite,
    },
  });
}
