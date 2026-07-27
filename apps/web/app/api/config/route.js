import { getConfig } from "../../../lib/radar-backend.js";
import { cacheHeader } from "../../../lib/http.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A cold instance pays lambda start + a fresh pooled connection before the
// query even runs; the default limit is too tight for that and turns into a
// 502. Reads stay far below this in the warm case.
export const maxDuration = 30;

export async function GET() {
  const { status, body } = await getConfig();
  return Response.json(body, { status, headers: cacheHeader(status, { sMaxAge: 900, swr: 86400 }) });
}
