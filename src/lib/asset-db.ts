/**
 * Asset database operations — CRUD for the assets table.
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";

function getSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export interface AssetRecord {
  id?: string;
  projectId: string;
  step: string;
  slotKey: string;
  filename: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  source: "generated" | "manual";
  width?: number;
  height?: number;
  durationMs?: number;
}

export interface AssetRow {
  id: string;
  project_id: string;
  type: string;
  filename: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  step: string | null;
  slot_key: string | null;
  source: string;
  url: string | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

function mimeToType(mime: string): string {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "other";
}

/**
 * Upsert an asset record (on project_id + step + slot_key).
 */
export async function upsertAssetRecord(asset: AssetRecord): Promise<AssetRow | null> {
  const sb = getSupabase();
  if (!sb) return null;

  const payload = {
    project_id: asset.projectId,
    type: mimeToType(asset.mimeType),
    filename: asset.filename,
    storage_path: asset.storagePath,
    mime_type: asset.mimeType,
    size_bytes: asset.sizeBytes,
    step: asset.step,
    slot_key: asset.slotKey,
    source: asset.source,
    url: asset.url,
    width: asset.width || null,
    height: asset.height || null,
    duration_ms: asset.durationMs || null,
  };

  const { data, error } = await sb
    .from("assets")
    .upsert(payload, { onConflict: "project_id,step,slot_key" })
    .select()
    .single();

  if (error) {
    console.error("[asset-db] upsert failed:", error.message);
    return null;
  }
  return data as AssetRow;
}

/**
 * List all assets for a project, ordered by step then slot.
 */
export async function listProjectAssets(projectId: string): Promise<AssetRow[]> {
  const sb = getSupabase();
  if (!sb) return [];

  const { data, error } = await sb
    .from("assets")
    .select("*")
    .eq("project_id", projectId)
    .order("step")
    .order("slot_key");

  if (error) {
    console.error("[asset-db] list failed:", error.message);
    return [];
  }
  return (data || []) as AssetRow[];
}

/**
 * Get a single asset by ID.
 */
export async function getAssetById(assetId: string): Promise<AssetRow | null> {
  const sb = getSupabase();
  if (!sb) return null;

  const { data, error } = await sb
    .from("assets")
    .select("*")
    .eq("id", assetId)
    .single();

  if (error) return null;
  return data as AssetRow;
}

/**
 * Delete an asset record and its storage file.
 */
export async function deleteAsset(assetId: string): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;

  // Get the asset first for storage path
  const asset = await getAssetById(assetId);
  if (!asset) return false;

  // Delete from storage
  if (asset.storage_path) {
    await sb.storage.from("project-assets").remove([asset.storage_path]);
  }

  // Delete from DB
  const { error } = await sb.from("assets").delete().eq("id", assetId);
  if (error) {
    console.error("[asset-db] delete failed:", error.message);
    return false;
  }
  return true;
}
