"use client";

import type { StepResult } from "@/types";

interface TimingEntry {
  scene: number;
  tag_type: "DALLE" | "RUNWAY" | "STOCK" | "MOTION_GRAPHIC";
  duration: number;
  label: string;
  asset_file?: string;
}

/**
 * Build a render package from completed pipeline steps.
 * Downloads all assets, creates timing.json, and zips everything
 * in the folder structure the Python render script expects.
 */
export async function downloadRenderPackage(
  projectTitle: string,
  steps: StepResult[],
  onProgress?: (stage: string, pct: number) => void
): Promise<void> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();

  const report = (stage: string, pct: number) => onProgress?.(stage, pct);
  report("Preparing render package", 5);

  const getOutput = (stepId: string) =>
    steps.find(s => s.step === stepId && s.status === "completed")?.output as Record<string, unknown> | undefined;

  // ── Gather data from steps ──
  const voiceover = getOutput("voiceover_generation");
  const imageGen = getOutput("image_generation");
  const stockFootage = getOutput("stock_footage");
  const timingSync = getOutput("timing_sync");
  const visualDirection = getOutput("visual_direction");
  const brandAssets = getOutput("brand_assets");
  const blendCurator = getOutput("blend_curator");
  const motionGraphics = getOutput("motion_graphics");
  const scriptRefinement = getOutput("script_refinement");
  const thumbnails = getOutput("thumbnail_creation");
  const hooks = getOutput("hook_engineering");
  const retention = getOutput("retention_structure");
  const commentMagnet = getOutput("comment_magnet");
  const uploadBlueprint = getOutput("upload_blueprint");

  // ── Build timing.json from visual direction + timing sync ──
  const timing: TimingEntry[] = [];
  let scenes: { section?: string; timestamp_approx?: string; dalle_prompt?: string; pexels_query?: string; duration_seconds?: number }[] = [];

  // Try to parse visual direction scenes
  if (visualDirection?.visuals) {
    try {
      const parsed = JSON.parse(visualDirection.visuals as string);
      scenes = Array.isArray(parsed) ? parsed : parsed.scenes || [];
    } catch {}
  }

  // Try to get timing data for durations
  let timingData: { start_time_seconds?: number; end_time_seconds?: number; section?: string }[] = [];
  if (timingSync?.timing) {
    try {
      const parsed = JSON.parse(timingSync.timing as string);
      timingData = Array.isArray(parsed) ? parsed : [];
    } catch {}
  }

  // Get DALL-E images
  const dalleImages = (imageGen?.images as { url: string; prompt: string; revised_prompt: string }[]) || [];

  // Get stock footage
  let stockVideos: { url: string; duration: number }[] = [];
  if (stockFootage?.footage && Array.isArray(stockFootage.footage)) {
    for (const group of stockFootage.footage as { videos: { url: string; duration: number }[] }[]) {
      stockVideos = stockVideos.concat(group.videos || []);
    }
  }

  // Build timing entries — match scenes to assets
  const voiceoverDuration = ((voiceover?.estimated_duration_minutes as number) || 7) * 60;

  if (scenes.length > 0) {
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const timingEntry = timingData[i];
      const duration = timingEntry
        ? (timingEntry.end_time_seconds || 0) - (timingEntry.start_time_seconds || 0)
        : scene.duration_seconds || Math.round(voiceoverDuration / scenes.length);

      // Determine tag type based on available assets and blend plan
      let tagType: TimingEntry["tag_type"] = "DALLE";
      const dalleIdx = i % dalleImages.length;

      timing.push({
        scene: i + 1,
        tag_type: tagType,
        duration: Math.max(duration, 2),
        label: scene.section || timingEntry?.section || `Scene ${i + 1}`,
        asset_file: dalleImages[dalleIdx] ? `dalle/scene_${i + 1}.png` : undefined,
      });
    }
  } else {
    // Fallback: create entries from images
    const segDuration = voiceoverDuration / Math.max(dalleImages.length, 1);
    for (let i = 0; i < dalleImages.length; i++) {
      timing.push({
        scene: i + 1,
        tag_type: "DALLE",
        duration: Math.round(segDuration),
        label: `Scene ${i + 1}`,
        asset_file: `dalle/scene_${i + 1}.png`,
      });
    }
  }

  // Add end card
  timing.push({
    scene: timing.length + 1,
    tag_type: "MOTION_GRAPHIC",
    duration: 12,
    label: "End Card",
  });

  report("Building package structure", 10);

  // ── Write timing.json ──
  zip.file("timing.json", JSON.stringify(timing, null, 2));

  // ── Download and add DALL-E images ──
  const dalleFolder = zip.folder("dalle")!;
  for (let i = 0; i < dalleImages.length; i++) {
    report(`Downloading image ${i + 1}/${dalleImages.length}`, 10 + Math.round((i / dalleImages.length) * 30));
    try {
      const res = await fetch(dalleImages[i].url);
      if (res.ok) {
        const blob = await res.blob();
        dalleFolder.file(`scene_${i + 1}.png`, blob);
      }
    } catch {
      console.warn(`Failed to download DALL-E image ${i + 1}`);
    }
  }

  // ── Add stock footage URLs (can't download video in browser easily) ──
  const stockFolder = zip.folder("stock")!;
  const stockManifest = stockVideos.map((v, i) => ({
    index: i + 1,
    url: v.url,
    duration: v.duration,
    note: "Download manually from Pexels — direct video download requires authentication",
  }));
  stockFolder.file("stock_manifest.json", JSON.stringify(stockManifest, null, 2));

  // ── Create empty folders for assets the user needs to add ──
  zip.folder("runway");
  zip.folder("graphics");

  // ── Add voiceover reference ──
  report("Adding voiceover", 45);
  if (voiceover?.audio_url) {
    try {
      const res = await fetch(voiceover.audio_url as string);
      if (res.ok) {
        const blob = await res.blob();
        zip.file("voiceover.mp3", blob);
      }
    } catch {
      zip.file("voiceover_url.txt", voiceover.audio_url as string);
    }
  } else {
    zip.file("voiceover_note.txt",
      "Voiceover audio was not persisted to storage.\n" +
      "Check your ElevenLabs history to download the generated audio.\n" +
      `Voice ID: ${voiceover?.voice_id || "unknown"}\n` +
      `Word count: ${voiceover?.word_count || "unknown"}`
    );
  }

  // ── Add all pre-production outputs as text files ──
  report("Adding pre-production documents", 55);
  const slug = projectTitle.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const docsFolder = zip.folder("docs")!;

  const docMappings: [string, string, unknown][] = [
    ["script_final", "Refined Script", scriptRefinement?.refined_script],
    ["hooks", "Hooks", hooks?.hooks],
    ["visual_direction", "Visual Direction", visualDirection?.visuals],
    ["blend_curator", "Blend Curator", blendCurator?.blend_plan],
    ["brand_assets", "Brand Assets", brandAssets?.brand],
    ["timing_sync", "Timing Sync", timingSync?.timing],
    ["thumbnails", "Thumbnail Concepts", thumbnails?.thumbnails],
    ["retention_structure", "Retention Structure", retention?.retention],
    ["comment_magnet", "Comment Magnet", commentMagnet?.engagement],
    ["upload_blueprint", "Upload Blueprint", uploadBlueprint?.upload],
    ["motion_graphics", "Motion Graphics Specs", motionGraphics?.motion_specs],
  ];

  for (const [filename, title, content] of docMappings) {
    if (!content) continue;
    const text = typeof content === "string" ? content : JSON.stringify(content, null, 2);
    docsFolder.file(`${slug}_${filename}.md`, `# ${title}\n\n${text}`);
  }

  // ── Add render script ──
  report("Adding render script", 65);
  zip.file("render.py", RENDER_SCRIPT);
  zip.file("README.md", README_CONTENT(projectTitle));

  // ── Generate zip ──
  report("Generating zip file", 75);
  const blob = await zip.generateAsync(
    { type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } },
    (metadata) => {
      report("Compressing", 75 + Math.round(metadata.percent * 0.2));
    }
  );

  report("Downloading", 98);

  // Download
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slug}_render_package.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60000);

  report("Complete", 100);
}

// ── Python render script included in the package ──
const RENDER_SCRIPT = `#!/usr/bin/env python3
"""
MindArchive Video Render Script
Pure Python + ffmpeg. No Premiere, no After Effects.

Usage:
  python render.py

Requirements:
  - Python 3.8+
  - ffmpeg installed and on PATH
  - Pillow (pip install Pillow)

Inputs (in this directory):
  - timing.json        Scene list with scene, tag_type, duration, label
  - dalle/             DALL-E generated images
  - stock/             Stock footage (download from stock_manifest.json URLs)
  - runway/            Runway AI generated video clips
  - graphics/          Motion graphic overlays
  - voiceover.mp3      Full narration audio
"""

import json
import os
import subprocess
import sys
import math

RESOLUTION = "1920x1080"
FPS = 25
CRF = 18
PRESET = "fast"

def run_ffmpeg(args, desc=""):
    """Run an ffmpeg command with error handling."""
    cmd = ["ffmpeg", "-y"] + args
    print(f"  {'[' + desc + '] ' if desc else ''}Running: {' '.join(cmd[:8])}...")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"  ERROR: {result.stderr[-500:]}")
        return False
    return True

def smoothstep(t):
    """Smoothstep easing function for Ken Burns."""
    return t * t * (3 - 2 * t)

def create_dalle_clip(image_path, output_path, duration, motion_variant=0):
    """Create Ken Burns clip from a still image with 3 motion variants."""
    d = int(duration * FPS)
    w, h = 1920, 1080

    if motion_variant == 0:
        # Zoom in (1.0 -> 1.08)
        zoom_expr = f"min(1.0+0.08*smooth(on/{d}),1.08)"
        x_expr = f"iw/2-(iw/zoom/2)"
        y_expr = f"ih/2-(ih/zoom/2)"
    elif motion_variant == 1:
        # Zoom out (1.08 -> 1.0)
        zoom_expr = f"max(1.08-0.08*smooth(on/{d}),1.0)"
        x_expr = f"iw/2-(iw/zoom/2)"
        y_expr = f"ih/2-(ih/zoom/2)"
    else:
        # Pan right with slight zoom
        zoom_expr = f"min(1.0+0.03*smooth(on/{d}),1.03)"
        x_expr = f"(iw-iw/zoom)*smooth(on/{d})"
        y_expr = f"ih/2-(ih/zoom/2)"

    # smoothstep function for ffmpeg
    smooth = "st(1,clip(ld(0),0,1));st(1,ld(1)*ld(1)*(3-2*ld(1)));ld(1)"
    zoom_filter = zoom_expr.replace("smooth(", f"st(0,").replace(")", f");{smooth})")

    vf = (
        f"scale=3840:2160:force_original_aspect_ratio=decrease,"
        f"pad=3840:2160:(ow-iw)/2:(oh-ih)/2:black,"
        f"zoompan=z='{zoom_filter}':x='{x_expr}':y='{y_expr}'"
        f":d={d}:s={w}x{h}:fps={FPS}"
    )

    return run_ffmpeg([
        "-loop", "1", "-i", image_path,
        "-vf", vf,
        "-c:v", "libx264", "-preset", PRESET, "-crf", str(CRF),
        "-t", str(duration), "-pix_fmt", "yuv420p",
        "-r", str(FPS), output_path
    ], f"DALLE scene")

def create_motion_graphic_clip(image_path, output_path, duration):
    """Subtle zoom for motion graphics."""
    d = int(duration * FPS)
    vf = (
        f"scale=3840:2160:force_original_aspect_ratio=decrease,"
        f"pad=3840:2160:(ow-iw)/2:(oh-ih)/2:black,"
        f"zoompan=z='min(1.0+0.02*(on/{d}),1.02)'"
        f":x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
        f":d={d}:s=1920x1080:fps={FPS},"
        f"fade=in:0:12,fade=out:{d-12}:12"
    )
    return run_ffmpeg([
        "-loop", "1", "-i", image_path,
        "-vf", vf,
        "-c:v", "libx264", "-preset", PRESET, "-crf", str(CRF),
        "-t", str(duration), "-pix_fmt", "yuv420p",
        "-r", str(FPS), output_path
    ], "MOTION_GRAPHIC")

def create_video_clip(video_path, output_path, duration):
    """Scale/crop video to 1920x1080, loop if needed."""
    vf = "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black"
    return run_ffmpeg([
        "-stream_loop", "-1", "-i", video_path,
        "-vf", vf,
        "-c:v", "libx264", "-preset", PRESET, "-crf", str(CRF),
        "-t", str(duration), "-pix_fmt", "yuv420p",
        "-r", str(FPS), output_path
    ], "VIDEO clip")

def create_end_card(output_path, duration=12):
    """Create a simple end card."""
    return run_ffmpeg([
        "-f", "lavfi", "-i", f"color=c=0x0D0D1A:s=1920x1080:d={duration}:r={FPS}",
        "-c:v", "libx264", "-preset", PRESET, "-crf", str(CRF),
        "-pix_fmt", "yuv420p", output_path
    ], "End card")

def main():
    print("\\n=== MindArchive Video Render ===\\n")

    if not os.path.exists("timing.json"):
        print("ERROR: timing.json not found. Run from the render package directory.")
        sys.exit(1)

    with open("timing.json") as f:
        timing = json.load(f)

    os.makedirs("clips", exist_ok=True)
    clip_files = []

    print(f"Processing {len(timing)} scenes...\\n")

    for i, entry in enumerate(timing):
        scene_num = entry["scene"]
        tag = entry["tag_type"]
        duration = entry["duration"]
        label = entry.get("label", f"Scene {scene_num}")
        clip_path = f"clips/clip_{scene_num:03d}.mp4"

        print(f"Scene {scene_num}: {label} ({tag}, {duration:.1f}s)")

        if tag == "DALLE":
            img = entry.get("asset_file") or f"dalle/scene_{scene_num}.png"
            if os.path.exists(img):
                variant = i % 3  # rotate through motion variants
                create_dalle_clip(img, clip_path, duration, variant)
                clip_files.append(clip_path)
            else:
                print(f"  WARNING: {img} not found, creating black clip")
                create_end_card(clip_path, duration)
                clip_files.append(clip_path)

        elif tag in ("RUNWAY", "STOCK"):
            # Look for video files
            folder = "runway" if tag == "RUNWAY" else "stock"
            video = None
            for ext in [".mp4", ".mov", ".webm"]:
                candidate = f"{folder}/scene_{scene_num}{ext}"
                if os.path.exists(candidate):
                    video = candidate
                    break
            if video:
                create_video_clip(video, clip_path, duration)
                clip_files.append(clip_path)
            else:
                print(f"  WARNING: No {tag} video found, creating black clip")
                create_end_card(clip_path, duration)
                clip_files.append(clip_path)

        elif tag == "MOTION_GRAPHIC":
            img = f"graphics/scene_{scene_num}.png"
            if os.path.exists(img):
                create_motion_graphic_clip(img, clip_path, duration)
            else:
                create_end_card(clip_path, duration)
            clip_files.append(clip_path)

        else:
            print(f"  Unknown tag type: {tag}")
            create_end_card(clip_path, duration)
            clip_files.append(clip_path)

    if not clip_files:
        print("ERROR: No clips generated!")
        sys.exit(1)

    # Concatenate all clips
    print("\\nConcatenating clips...")
    concat_file = "clips/concat.txt"
    with open(concat_file, "w") as f:
        for clip in clip_files:
            f.write(f"file '../{clip}'\\n")

    run_ffmpeg([
        "-f", "concat", "-safe", "0", "-i", concat_file,
        "-c", "copy", "silent_video.mp4"
    ], "Concat")

    # Build final with audio
    print("\\nMerging audio...")
    if os.path.exists("voiceover.mp3"):
        run_ffmpeg([
            "-i", "silent_video.mp4",
            "-i", "voiceover.mp3",
            "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
            "-shortest", "-movflags", "+faststart",
            "output_horizontal.mp4"
        ], "Final horizontal")
    else:
        print("WARNING: voiceover.mp3 not found — outputting silent video")
        os.rename("silent_video.mp4", "output_horizontal.mp4")

    # Vertical version
    print("\\nCreating vertical version...")
    run_ffmpeg([
        "-i", "output_horizontal.mp4",
        "-vf", "crop=ih*9/16:ih,scale=1080:1920",
        "-c:v", "libx264", "-preset", PRESET, "-crf", str(CRF),
        "-c:a", "copy", "-movflags", "+faststart",
        "output_vertical.mp4"
    ], "Final vertical")

    print("\\n=== Render Complete ===")
    print(f"  Horizontal: output_horizontal.mp4")
    print(f"  Vertical:   output_vertical.mp4")
    total_duration = sum(e["duration"] for e in timing)
    print(f"  Total duration: {total_duration:.1f}s ({total_duration/60:.1f} min)")

if __name__ == "__main__":
    main()
`;

function README_CONTENT(title: string): string {
  return `# ${title} — Render Package

## Quick Start

\`\`\`bash
pip install Pillow
python render.py
\`\`\`

## Contents

| File/Folder | Description |
|------------|-------------|
| \`timing.json\` | Scene list with timing, tag types, and asset references |
| \`dalle/\` | DALL-E generated scene images |
| \`stock/\` | Stock footage (see stock_manifest.json for download URLs) |
| \`runway/\` | Runway AI video clips (add manually if generated) |
| \`graphics/\` | Motion graphic overlays (add manually) |
| \`voiceover.mp3\` | Narration audio |
| \`docs/\` | All pre-production outputs (script, hooks, brand, etc.) |
| \`render.py\` | Python render script (requires ffmpeg on PATH) |

## Requirements

- Python 3.8+
- ffmpeg installed and on PATH
- ~2GB free disk space for rendering

## Output

- \`output_horizontal.mp4\` — 1920×1080 landscape
- \`output_vertical.mp4\` — 1080×1920 vertical/shorts

## Render Settings

- Codec: H.264 (libx264)
- Quality: CRF 18 (high quality)
- FPS: 25
- Audio: AAC 192kbps
- Ken Burns: 3 rotating motion variants with smoothstep easing
`;
}
