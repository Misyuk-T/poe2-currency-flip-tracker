import { getRadar } from "../../../lib/radar-backend.js";
import { cacheHeader } from "../../../lib/http.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const { status, body } = await getRadar(searchParams);
    // The source advances only on completed hourly digests. Keep a five-minute
    // fresh edge copy and serve the previous hour immediately while Vercel
    // revalidates in the background instead of making league switches wait on
    // a cold database computation.
    return Response.json(body, { status, headers: cacheHeader(status, { sMaxAge: 300, swr: 3600 }) });
  } catch {
    return Response.json(
      { error: { code: "radar-failed", message: "radar unavailable" } },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
