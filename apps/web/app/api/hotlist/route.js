import { getHotlist } from "../../../lib/radar-backend.js";
import { cacheHeader } from "../../../lib/http.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { status, body } = await getHotlist();
    return Response.json(body, { status, headers: cacheHeader(status, { sMaxAge: 60, swr: 300 }) });
  } catch {
    return Response.json(
      { error: { code: "hotlist-failed", message: "hotlist unavailable" } },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
