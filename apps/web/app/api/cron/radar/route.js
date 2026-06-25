import { runRadarIngest, isCronAuthorized, cronConfigured } from "../../../../lib/radar-backend.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Hourly radar ingestion. Triggered by Supabase pg_cron via pg_net (POST with a
// Bearer CRON_SECRET); GET is accepted too for manual/Vercel-cron invocation.
async function handle(request) {
  if (!cronConfigured()) {
    return Response.json(
      { error: { code: "cron-disabled", message: "CRON_SECRET is not configured." } },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!isCronAuthorized(request.headers.get("authorization"))) {
    return Response.json(
      { error: { code: "unauthorized", message: "invalid cron secret" } },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const { status, body } = await runRadarIngest({ now: Date.now() });
    return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(
      { error: { code: "ingest-failed", message: "radar ingestion failed" } },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export const GET = handle;
export const POST = handle;
