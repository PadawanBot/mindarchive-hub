import * as fs from "fs/promises";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || "";
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || "";
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || "";
const R2_BUCKET = process.env.R2_BUCKET || "";
const R2_PUBLIC_BASE = process.env.R2_PUBLIC_BASE || "";

// Legacy Cloudflare REST API credentials (fallback for small files)
const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || "";

/**
 * Upload a file to Cloudflare R2.
 *
 * Primary: S3-compatible API via @aws-sdk/client-s3 (supports up to 5 GB per PUT).
 * Fallback: Cloudflare REST API (limited to ~100 MB by Cloudflare's edge proxy).
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
  const fileBuffer = await fs.readFile(filePath);
  const sizeMB = (fileBuffer.length / 1024 / 1024).toFixed(1);

  console.log(`[R2] Uploading ${key} (${sizeMB} MB)...`);

  // Prefer S3-compatible API (no body size limit from Cloudflare edge proxy)
  if (R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && CF_ACCOUNT_ID && R2_BUCKET) {
    await uploadViaS3(fileBuffer, key, contentType);
  } else if (CF_API_TOKEN && CF_ACCOUNT_ID && R2_BUCKET) {
    // Fallback to REST API (works for files under ~100 MB)
    console.warn(`[R2] S3 credentials not configured — falling back to REST API (100 MB limit)`);
    await uploadViaRestApi(fileBuffer, key, contentType);
  } else {
    throw new Error(
      "R2 credentials not configured. Set R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY (preferred) " +
      "or CLOUDFLARE_API_TOKEN (fallback), plus CLOUDFLARE_ACCOUNT_ID and R2_BUCKET."
    );
  }

  const publicUrl = `${R2_PUBLIC_BASE}/${key}`;
  console.log(`[R2] Upload complete: ${publicUrl}`);
  return publicUrl;
}

/**
 * Upload via R2's S3-compatible API using PutObjectCommand.
 * Supports files up to 5 GB in a single PUT.
 */
async function uploadViaS3(
  fileBuffer: Buffer,
  key: string,
  contentType: string
): Promise<void> {
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${CF_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });

  const command = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: fileBuffer,
    ContentType: contentType,
  });

  // 10-minute timeout for large videos
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 600_000);

  try {
    await client.send(command, { abortSignal: abortController.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Upload via Cloudflare REST API (legacy).
 * Limited to ~100 MB by Cloudflare's edge proxy — will 413 on larger files.
 */
async function uploadViaRestApi(
  fileBuffer: Buffer,
  key: string,
  contentType: string
): Promise<void> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/r2/buckets/${R2_BUCKET}/objects/${key}`;

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${CF_API_TOKEN}`,
      "Content-Type": contentType,
    },
    body: fileBuffer,
    signal: AbortSignal.timeout(600_000),
  });

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
}
