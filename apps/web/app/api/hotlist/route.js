import { getHotlist } from "../../../lib/radar-backend.js";
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
    const { status, body } = await getHotlist(searchParams);
    return Response.json(body, { status, headers: cacheHeader(status, { sMaxAge: 900, swr: 86400 }) });
  } catch {
    return Response.json(
      { error: { code: "hotlist-failed", message: "hotlist unavailable" } },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
