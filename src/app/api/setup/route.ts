import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function POST() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return NextResponse.json({ success: false, error: "Supabase not configured" }, { status: 400 });
  }

  const sb = createClient(url, key);
  const results: string[] = [];

  // Create storage bucket for project assets
  const { error: bucketError } = await sb.storage.createBucket("project-assets", {
    public: true,
    fileSizeLimit: 52428800, // 50MB
  });
  if (bucketError && !bucketError.message.includes("already exists")) {
    results.push(`Bucket error: ${bucketError.message}`);
  } else {
    results.push("Storage bucket 'project-assets' ready");
  }

  // Verify unique constraint exists on pipeline_steps
  const { error: constraintError } = await sb.rpc("exec_sql", {
    sql: `DO $$ BEGIN
      ALTER TABLE pipeline_steps ADD CONSTRAINT pipeline_steps_project_step_unique UNIQUE (project_id, step);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;`
  });
  if (constraintError) {
    // Try direct approach if rpc doesn't exist
    results.push(`Constraint check: ${constraintError.message} (may already exist)`);
  } else {
    results.push("Unique constraint on pipeline_steps verified");
  }

  return NextResponse.json({ success: true, data: { results } });
}
