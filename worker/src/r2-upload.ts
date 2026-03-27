import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import * as fs from "fs/promises";

const R2_ENDPOINT = process.env.R2_ENDPOINT || "";
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY_ID || "";
const R2_SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY || "";
const R2_BUCKET = process.env.R2_BUCKET || "";
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || "";

let _client: S3Client | null = null;

function getClient(): S3Client {
  if (!_client) {
    if (!R2_ENDPOINT || !R2_ACCESS_KEY || !R2_SECRET_KEY) {
      throw new Error(
        "R2 credentials not configured. Set R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY env vars."
      );
    }
    _client = new S3Client({
      region: "auto",
      endpoint: R2_ENDPOINT,
      credentials: {
        accessKeyId: R2_ACCESS_KEY,
        secretAccessKey: R2_SECRET_KEY,
      },
    });
  }
  return _client;
}

/**
 * Upload a file to Cloudflare R2 and return its public URL.
 *
 * @param filePath  Local file path to upload
 * @param key       R2 object key, e.g. "videos/project-id/final-video.mp4"
 * @param contentType  MIME type, e.g. "video/mp4"
 * @returns Public URL of the uploaded object
 */
export async function uploadToR2(
  filePath: string,
  key: string,
  contentType: string
): Promise<string> {
  const client = getClient();
  const fileBuffer = await fs.readFile(filePath);

  console.log(
    `[R2] Uploading ${key} (${(fileBuffer.length / 1024 / 1024).toFixed(1)} MB)...`
  );

  await client.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: fileBuffer,
      ContentType: contentType,
    })
  );

  const publicUrl = `${R2_PUBLIC_URL}/${key}`;
  console.log(`[R2] Upload complete: ${publicUrl}`);
  return publicUrl;
}
