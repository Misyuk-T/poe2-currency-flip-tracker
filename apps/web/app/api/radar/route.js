import { getRadar } from "../../../lib/radar-backend.js";
import { cacheHeader } from "../../../lib/http.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A cold instance pays lambda start + a fresh pooled connection before the
// query even runs; the default limit is too tight for that and turns into a
// 502. Reads stay far below this in the warm case.
export const maxDuration = 30;

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const { status, body } = await getRadar(searchParams);
    // The source only advances on completed hourly digests, so a one-hour
    // fresh window matches the data's actual granularity. The long
    // stale-while-revalidate is the point: after an idle stretch the next
    // visitor is served the previous copy instantly while Vercel refreshes in
    // the background, instead of waiting on — or 502ing from — a cold database
    // path. Staleness is visible in the payload's generatedAt.
    return Response.json(body, { status, headers: cacheHeader(status, { sMaxAge: 3600, swr: 86400 }) });
  } catch (error) {
    console.error("[api/radar] request failed", {
      errorName: error?.name ?? "Error",
      errorCode: error?.code ?? null,
      errorMessage: error?.message ?? String(error),
    });
    return Response.json(
      { error: { code: "radar-failed", message: "radar unavailable" } },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
