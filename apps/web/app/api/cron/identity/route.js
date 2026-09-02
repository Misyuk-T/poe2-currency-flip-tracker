import { randomUUID } from "node:crypto";
import { isCronAuthorized, cronConfigured } from "../../../../lib/radar-backend.js";
import { runCurrencyIdentityRefresh } from "../../../../lib/identity-refresh.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Two bounded upstream fetches (10s each, one retry) plus at most 200 upserts.
// Far below the ingest route's 300s because this job is small by construction —
// and the pg_cron transport in migration 010 is set to the same 60s.
export const maxDuration = 60;

// Daily currency-identity refresh. Triggered by Supabase pg_cron via pg_net
// (POST with a Bearer CRON_SECRET, migration 010); GET is accepted too for
// manual invocation. Same auth as /api/cron/radar, deliberately sharing
// isCronAuthorized/CRON_SECRET rather than growing a second secret to rotate.
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
    const entry = { event: "cx-identity", runId, phase, elapsedMs: Date.now() - startedAt, ...details };
    const level = phase.endsWith(".error") ? "error" : "log";
    console[level](JSON.stringify(entry));
  };
  trace("request.start", { method: request.method });
  try {
    const games = await runCurrencyIdentityRefresh({ now: startedAt, trace });
    trace("request.end", { games: games.length });
    return Response.json({ games }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    trace("request.error", {
      errorName: error?.name ?? "Error",
      errorCode: error?.code ?? null,
      errorMessage: error?.message ?? String(error),
      stack: error?.stack ?? null,
    });
    return Response.json(
      { error: { code: "identity-refresh-failed", message: "currency identity refresh failed", runId } },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export const GET = handle;
export const POST = handle;
