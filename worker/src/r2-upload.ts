import * as fs from "fs/promises";

const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || "";
const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";
const R2_BUCKET = process.env.R2_BUCKET || "";
const R2_PUBLIC_BASE = process.env.R2_PUBLIC_BASE || "";

/**
 * Upload a file to Cloudflare R2 via the Cloudflare REST API.
 *
 * Uses API Token auth (not S3-compatible credentials).
 * Same approach as the existing audiobook upload scripts.
 *
 * @param filePath     Local file path to upload
 * @param key          R2 object key, e.g. "videos/project-id/final-video.mp4"
 * @param contentType  MIME type, e.g. "video/mp4"
 * @returns Public URL of the uploaded object
 */
export async function uploadToR2(
  filePath: string,
  key: string,
  contentType: string
): Promise<string> {
  if (!CF_ACCOUNT_ID || !CF_API_TOKEN || !R2_BUCKET) {
    throw new Error(
      "R2 credentials not configured. Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, R2_BUCKET env vars."
    );
  }

  const fileBuffer = await fs.readFile(filePath);
  const sizeMB = (fileBuffer.length / 1024 / 1024).toFixed(1);

  console.log(`[R2] Uploading ${key} (${sizeMB} MB)...`);

  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/r2/buckets/${R2_BUCKET}/objects/${key}`;

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${CF_API_TOKEN}`,
      "Content-Type": contentType,
    },
    body: fileBuffer,
    signal: AbortSignal.timeout(600_000), // 10 minutes — large videos (200-300MB) need time
  });

  // Guard against HTML error pages (auth failures, 5xx, etc.)
  const responseText = await response.text();
  if (!response.ok) {
    const preview = responseText.slice(0, 300);
    throw new Error(
      `R2 upload failed: HTTP ${response.status} ${response.statusText} — ${preview}`
    );
  }

  let result: { success: boolean; errors?: unknown[] };
  try {
    result = JSON.parse(responseText);
  } catch {
    throw new Error(
      `R2 upload returned non-JSON response (HTTP ${response.status}): ${responseText.slice(0, 300)}`
    );
  }

  if (!result.success) {
    throw new Error(`R2 upload failed: ${JSON.stringify(result.errors)}`);
  }

  const publicUrl = `${R2_PUBLIC_BASE}/${key}`;
  console.log(`[R2] Upload complete: ${publicUrl}`);
  return publicUrl;
}
