import { getStatus } from "../../../lib/radar-backend.js";
import { cacheHeader } from "../../../lib/http.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { status, body } = await getStatus();
    // Only cache a real, configured status — never the degraded "no-database" one.
    const headers =
      status === 200 && body?.radar?.configured ? cacheHeader(200, { sMaxAge: 30, swr: 120 }) : { "Cache-Control": "no-store" };
    return Response.json(body, { status, headers });
  } catch {
    return Response.json(
      { error: { code: "status-failed", message: "status unavailable" } },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
