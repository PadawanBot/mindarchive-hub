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
  if (!url || !key) {
    console.warn("[storage] Missing SUPABASE_URL or key — storage unavailable");
    return null;
  }
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
    } catch (err) {
      console.error("[storage] Local fallback write failed:", err);
      return null;
    }
  }

  const storagePath = `${projectId}/${filename}`;
  const dataSize = data instanceof ArrayBuffer ? data.byteLength : data.length;
  console.log(`[storage] Uploading ${storagePath} (${(dataSize / 1024).toFixed(1)}KB, ${mimeType})`);

  const { error } = await sb.storage
    .from(BUCKET)
    .upload(storagePath, data, {
      contentType: mimeType,
      upsert: true,
    });

  if (error) {
    console.error(`[storage] Upload failed for ${storagePath}: ${error.message}`);
    return null;
  }

  const { data: urlData } = sb.storage.from(BUCKET).getPublicUrl(storagePath);
  console.log(`[storage] Upload success: ${urlData.publicUrl.slice(0, 80)}...`);
  return urlData.publicUrl;
}

/**
 * Download a URL and upload its contents to Supabase Storage.
 * Useful for persisting ephemeral URLs (DALL-E images, etc.)
 * Returns the Supabase public URL, or null on failure.
 */
export async function downloadAndStore(
  projectId: string,
  filename: string,
  sourceUrl: string,
  mimeType: string
): Promise<string | null> {
  try {
    console.log(`[storage] Downloading from ${sourceUrl.slice(0, 80)}...`);
    const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      console.error(`[storage] Download failed: ${response.status} ${response.statusText}`);
      return null;
    }
    const buffer = await response.arrayBuffer();
    console.log(`[storage] Downloaded ${(buffer.byteLength / 1024).toFixed(1)}KB, uploading as ${filename}`);
    return uploadAsset(projectId, filename, buffer, mimeType);
  } catch (err) {
    console.error(`[storage] downloadAndStore failed:`, err);
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

/**
 * Create a signed upload URL for direct client-to-Supabase uploads.
 * Used for large files (>4MB) that exceed Vercel's body limit.
 */
export async function createSignedUploadUrl(
  storagePath: string,
  _mimeType: string
): Promise<{ signedUrl: string; token: string } | null> {
  const sb = getStorageClient();
  if (!sb) return null;

  const { data, error } = await sb.storage
    .from(BUCKET)
    .createSignedUploadUrl(storagePath);

  if (error || !data) {
    console.error(`[storage] Signed upload URL failed: ${error?.message}`);
    return null;
  }

  return { signedUrl: data.signedUrl, token: data.token };
}

/**
 * Delete a file from Supabase Storage.
 */
export async function deleteFromStorage(storagePath: string): Promise<boolean> {
  const sb = getStorageClient();
  if (!sb) return false;

  const { error } = await sb.storage.from(BUCKET).remove([storagePath]);
  if (error) {
    console.error(`[storage] Delete failed: ${error.message}`);
    return false;
  }
  return true;
}
