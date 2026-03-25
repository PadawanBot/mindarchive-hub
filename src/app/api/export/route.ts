import { NextRequest, NextResponse } from "next/server";
import { getById, getStepsByProject } from "@/lib/store";
import type { Project, StepResult } from "@/types";

export const maxDuration = 15;

const STEPS = [
  { id: "topic_research", label: "Topic Research" },
  { id: "script_writing", label: "Script Writing" },
  { id: "hook_engineering", label: "Hook Engineering" },
  { id: "voice_selection", label: "Voice Selection" },
  { id: "visual_direction", label: "Visual Direction" },
  { id: "blend_curator", label: "Blend Curator" },
  { id: "brand_assets", label: "Brand Assets" },
  { id: "script_refinement", label: "Script Refinement" },
  { id: "timing_sync", label: "Timing Sync" },
  { id: "thumbnail_creation", label: "Thumbnail Creation" },
  { id: "retention_structure", label: "Retention Structure" },
  { id: "comment_magnet", label: "Comment Magnet" },
  { id: "upload_blueprint", label: "Upload Blueprint" },
  { id: "voiceover_generation", label: "Voiceover Generation" },
  { id: "image_generation", label: "Image Generation" },
  { id: "stock_footage", label: "Stock Footage" },
  { id: "motion_graphics", label: "Motion Graphics" },
  { id: "hero_scenes", label: "Hero Scenes" },
];

function getStepLabel(stepId: string): string {
  return STEPS.find((s) => s.id === stepId)?.label ?? stepId;
}

/**
 * Extract the main text content from a step output object by finding
 * the longest string value (recursively).
 */
function extractMainText(output: Record<string, unknown>): string {
  let longest = "";

  function walk(obj: unknown): void {
    if (typeof obj === "string") {
      if (obj.length > longest.length) longest = obj;
      return;
    }
    if (Array.isArray(obj)) {
      for (const item of obj) walk(item);
      return;
    }
    if (obj && typeof obj === "object") {
      for (const val of Object.values(obj as Record<string, unknown>)) {
        walk(val);
      }
    }
  }

  walk(output);
  return longest;
}

function isJsonLike(text: string): boolean {
  const trimmed = text.trim();
  return (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"));
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function renderMarkdown(project: Project, steps: StepResult[]): string {
  const lines: string[] = [];

  lines.push(`# ${project.title}`);
  lines.push("");
  lines.push(`**Topic:** ${project.topic}`);
  lines.push("");

  if (project.script_data) {
    lines.push("## Script");
    lines.push("");
    const scriptText = extractMainText(project.script_data);
    if (scriptText) {
      if (isJsonLike(scriptText)) {
        lines.push("```json");
        lines.push(scriptText);
        lines.push("```");
      } else {
        lines.push(scriptText);
      }
      lines.push("");
    } else {
      lines.push("```json");
      lines.push(JSON.stringify(project.script_data, null, 2));
      lines.push("```");
      lines.push("");
    }
  }

  for (const step of steps) {
    const label = getStepLabel(step.step);
    lines.push(`## ${label}`);
    lines.push("");
    lines.push(`- **Duration:** ${step.duration_ms != null ? `${step.duration_ms}ms` : "N/A"}`);
    lines.push(`- **Cost:** ${step.cost_cents != null ? `${step.cost_cents} cents` : "N/A"}`);
    lines.push("");

    if (step.output) {
      const text = extractMainText(step.output);
      if (text) {
        if (isJsonLike(text)) {
          lines.push("```json");
          lines.push(text);
          lines.push("```");
        } else {
          lines.push(text);
        }
      } else {
        lines.push("```json");
        lines.push(JSON.stringify(step.output, null, 2));
        lines.push("```");
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

function renderText(project: Project, steps: StepResult[]): string {
  const lines: string[] = [];

  lines.push(project.title);
  lines.push("=".repeat(project.title.length));
  lines.push("");
  lines.push(`Topic: ${project.topic}`);
  lines.push("");

  if (project.script_data) {
    lines.push("Script");
    lines.push("===");
    lines.push("");
    const scriptText = extractMainText(project.script_data);
    if (scriptText) {
      lines.push(scriptText);
    } else {
      lines.push(JSON.stringify(project.script_data, null, 2));
    }
    lines.push("");
  }

  for (const step of steps) {
    const label = getStepLabel(step.step);
    lines.push("===".repeat(10));
    lines.push(label);
    lines.push("===".repeat(10));
    lines.push("");
    lines.push(`Duration: ${step.duration_ms != null ? `${step.duration_ms}ms` : "N/A"}`);
    lines.push(`Cost: ${step.cost_cents != null ? `${step.cost_cents} cents` : "N/A"}`);
    lines.push("");

    if (step.output) {
      const text = extractMainText(step.output);
      lines.push(text || JSON.stringify(step.output, null, 2));
      lines.push("");
    }
  }

  return lines.join("\n");
}

function renderJson(project: Project, steps: StepResult[]): string {
  return JSON.stringify(
    {
      project: {
        id: project.id,
        title: project.title,
        topic: project.topic,
        script_data: project.script_data ?? null,
      },
      steps: steps.map((step) => ({
        step: step.step,
        label: getStepLabel(step.step),
        output: step.output ?? null,
        duration_ms: step.duration_ms ?? null,
        cost_cents: step.cost_cents ?? null,
      })),
    },
    null,
    2
  );
}

const MIME_TYPES: Record<string, string> = {
  md: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  json: "application/json; charset=utf-8",
};

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const projectId = searchParams.get("project_id");
  const format = searchParams.get("format") || "md";
  const stepsParam = searchParams.get("steps") || "all";

  if (!projectId) {
    return NextResponse.json(
      { success: false, error: "project_id is required" },
      { status: 400 }
    );
  }

  if (!["md", "txt", "json"].includes(format)) {
    return NextResponse.json(
      { success: false, error: "format must be md, txt, or json" },
      { status: 400 }
    );
  }

  const project = await getById<Project>("projects", projectId);
  if (!project) {
    return NextResponse.json(
      { success: false, error: "Project not found" },
      { status: 404 }
    );
  }

  let allSteps = await getStepsByProject(projectId);

  // Filter to completed steps only
  allSteps = allSteps.filter((s) => s.status === "completed");

  // Filter by requested step IDs
  if (stepsParam !== "all") {
    const requestedIds = stepsParam.split(",").map((s) => s.trim());
    allSteps = allSteps.filter((s) => requestedIds.includes(s.step));
  }

  let body: string;
  switch (format) {
    case "txt":
      body = renderText(project, allSteps);
      break;
    case "json":
      body = renderJson(project, allSteps);
      break;
    default:
      body = renderMarkdown(project, allSteps);
      break;
  }

  const slug = slugify(project.title) || "project";
  const filename = `${slug}-export.${format}`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": MIME_TYPES[format],
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
