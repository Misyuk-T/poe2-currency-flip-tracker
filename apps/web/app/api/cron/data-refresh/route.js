import { randomUUID } from "node:crypto";
import { isCronAuthorized, cronConfigured } from "../../../../lib/radar-backend.js";
import { runDataRefresh } from "../../../../lib/data-refresh.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// At most three bounded HTML fetches (10s each, one retry) plus ~1800 upserts in
// batches of 50. Far below the ingest route's 300s because this job is small by
// construction — and the pg_cron transport in migration 011 is set to the same
// 60s, exactly as the identity job's is.
export const maxDuration = 60;

// Daily exchange-layout + gold-cost refresh. Triggered by Supabase pg_cron via
// pg_net (POST with a Bearer CRON_SECRET, migration 011); GET is accepted too
// for manual invocation. Same auth as /api/cron/radar and /api/cron/identity,
// deliberately sharing isCronAuthorized/CRON_SECRET rather than growing a third
// secret to rotate.
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
    const entry = { event: "data-refresh", runId, phase, elapsedMs: Date.now() - startedAt, ...details };
    const level = phase.endsWith(".error") || phase.endsWith(".rejected") ? "error" : "log";
    console[level](JSON.stringify(entry));
  };
  trace("request.start", { method: request.method });
  try {
    // runDataRefresh isolates every game and every task internally, so a single
    // failed scrape is reported in the body and never fails the response. This
    // catch is for the paths it cannot own — config loading, an import fault.
    const tasks = await runDataRefresh({ now: startedAt, trace });
    trace("request.end", { tasks: tasks.length });
    return Response.json({ tasks }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    trace("request.error", {
      errorName: error?.name ?? "Error",
      errorCode: error?.code ?? null,
      errorMessage: error?.message ?? String(error),
      stack: error?.stack ?? null,
    });
    return Response.json(
      { error: { code: "data-refresh-failed", message: "layout/gold refresh failed", runId } },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export const GET = handle;
export const POST = handle;
