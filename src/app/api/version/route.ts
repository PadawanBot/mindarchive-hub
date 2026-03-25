export const dynamic = "force-dynamic";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const hasSecretKey = !!process.env.SUPABASE_SECRET_KEY;
  const hasServiceKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  const hasPublishableKey = !!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const hasAnonKey = !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Test actual Supabase connection
  let supabaseStatus = "not configured";
  if (url) {
    try {
      const { createClient } = await import("@supabase/supabase-js");
      const key = process.env.SUPABASE_SECRET_KEY
        || process.env.SUPABASE_SERVICE_ROLE_KEY
        || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
        || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (key) {
        const sb = createClient(url, key);
        const { data, error } = await sb.from("settings").select("key").limit(1);
        supabaseStatus = error ? `error: ${error.message}` : `connected (${data?.length ?? 0} settings)`;
      } else {
        supabaseStatus = "no key found";
      }
    } catch (err) {
      supabaseStatus = `exception: ${String(err)}`;
    }
  }

  return Response.json({
    version: "3.1.0",
    build: process.env.NEXT_BUILD_ID || "unknown",
    supabase: {
      url: url ? url.slice(0, 30) + "..." : "not set",
      hasSecretKey,
      hasServiceKey,
      hasPublishableKey,
      hasAnonKey,
      status: supabaseStatus,
    },
  });
}
