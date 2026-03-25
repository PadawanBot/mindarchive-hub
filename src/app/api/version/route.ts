export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    version: "3.0.0",
    build: process.env.NEXT_BUILD_ID || "unknown",
    node: process.version,
    timestamp: "2026-03-25T08:00:00Z",
  });
}
