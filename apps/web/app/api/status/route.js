import { getStatus } from "../../../lib/radar-backend.js";
import { cacheHeader } from "../../../lib/http.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { status, body } = await getStatus();
    return Response.json(body, { status, headers: cacheHeader(status, { sMaxAge: 30, swr: 120 }) });
  } catch {
    return Response.json(
      { error: { code: "status-failed", message: "status unavailable" } },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
