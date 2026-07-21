import { randomUUID } from "node:crypto";
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
  const runId = randomUUID();
  const startedAt = Date.now();
  const trace = (phase, details = {}) => {
    const entry = { event: "radar-ingest", runId, phase, elapsedMs: Date.now() - startedAt, ...details };
    const level = phase.endsWith(".error") ? "error" : "log";
    console[level](JSON.stringify(entry));
  };
  trace("request.start", { method: request.method });
  try {
    const { status, body } = await runRadarIngest({ now: startedAt, trace });
    trace("request.end", { status, mode: body?.mode ?? null });
    return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    trace("request.error", {
      errorName: error?.name ?? "Error",
      errorCode: error?.code ?? null,
      errorMessage: error?.message ?? String(error),
      stack: error?.stack ?? null,
    });
    return Response.json(
      { error: { code: "ingest-failed", message: "radar ingestion failed", runId } },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export const GET = handle;
export const POST = handle;
