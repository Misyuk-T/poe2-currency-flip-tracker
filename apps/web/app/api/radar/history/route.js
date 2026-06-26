import { getHistory } from "../../../../lib/radar-backend.js";
import { cacheHeader } from "../../../../lib/http.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const { status, body } = await getHistory(searchParams);
    return Response.json(body, { status, headers: cacheHeader(status, { sMaxAge: 120, swr: 600 }) });
  } catch {
    return Response.json(
      { error: { code: "history-failed", message: "history unavailable" } },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
