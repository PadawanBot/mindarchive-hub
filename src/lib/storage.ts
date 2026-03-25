/**
 * Asset storage — uploads files to Supabase Storage for persistent access.
 * Falls back to local filesystem for dev.
 */
import { createClient } from "@supabase/supabase-js";

const BUCKET = "project-assets";

function getStorageClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/**
 * Upload a binary asset to Supabase Storage.
 * Returns the public URL or null if storage is unavailable.
 */
export async function uploadAsset(
  projectId: string,
  filename: string,
  data: ArrayBuffer | Buffer | Uint8Array,
  mimeType: string
): Promise<string | null> {
  const sb = getStorageClient();
  if (!sb) {
    // Local dev fallback — save to filesystem
    try {
      const { promises: fs } = await import("fs");
      const path = await import("path");
      const dir = path.join(process.cwd(), ".mindarchive", "assets", projectId);
      await fs.mkdir(dir, { recursive: true });
      const filePath = path.join(dir, filename);
      await fs.writeFile(filePath, Buffer.from(data));
      return `/assets/${projectId}/${filename}`;
    } catch {
      return null;
    }
  }

  const storagePath = `${projectId}/${filename}`;

  const { error } = await sb.storage
    .from(BUCKET)
    .upload(storagePath, data, {
      contentType: mimeType,
      upsert: true,
    });

  if (error) {
    console.error(`[storage] Upload failed: ${error.message}`);
    return null;
  }

  const { data: urlData } = sb.storage.from(BUCKET).getPublicUrl(storagePath);
  return urlData.publicUrl;
}

/**
 * Download a URL and upload its contents to Supabase Storage.
 * Useful for persisting ephemeral URLs (DALL-E images, etc.)
 */
export async function downloadAndStore(
  projectId: string,
  filename: string,
  sourceUrl: string,
  mimeType: string
): Promise<string | null> {
  try {
    const response = await fetch(sourceUrl);
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    return uploadAsset(projectId, filename, buffer, mimeType);
  } catch {
    return null;
  }
}

/**
 * Get the public URL for a stored asset.
 */
export function getAssetUrl(storagePath: string): string | null {
  const sb = getStorageClient();
  if (!sb) return null;
  const { data } = sb.storage.from(BUCKET).getPublicUrl(storagePath);
  return data.publicUrl;
}
