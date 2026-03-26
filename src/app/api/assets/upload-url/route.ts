/**
 * POST /api/assets/upload-url — Get a signed upload URL for large files (>4MB).
 * Client uploads directly to Supabase Storage, then calls /api/assets/confirm-upload.
 */
import { NextResponse } from "next/server";
import { createSignedUploadUrl } from "@/lib/storage";
import { getSlotDef, validateFile, storageFilename } from "@/lib/asset-validation";

export async function POST(request: Request) {
  try {
    const { project_id, step, slot_key, mime_type, size_bytes } = await request.json();

    if (!project_id || !step || !slot_key || !mime_type) {
      return NextResponse.json(
        { success: false, error: "Missing required fields" },
        { status: 400 }
      );
    }

    const slotDef = getSlotDef(step, slot_key);
    if (!slotDef) {
      return NextResponse.json(
        { success: false, error: `Unknown slot: ${step}/${slot_key}` },
        { status: 400 }
      );
    }

    // Pre-validate mime type and size
    const validation = validateFile(
      { mimeType: mime_type, sizeBytes: size_bytes || 0 },
      slotDef
    );
    if (!validation.valid) {
      return NextResponse.json(
        { success: false, error: validation.errors.join("; ") },
        { status: 422 }
      );
    }

    const filename = storageFilename(step, slot_key, mime_type);
    const storagePath = `${project_id}/${filename}`;

    const result = await createSignedUploadUrl(storagePath, mime_type);
    if (!result) {
      return NextResponse.json(
        { success: false, error: "Could not create signed upload URL — Supabase not configured?" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        upload_url: result.signedUrl,
        storage_path: storagePath,
        filename,
        token: result.token,
      },
    });
  } catch (error) {
    console.error("[assets/upload-url]", error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
