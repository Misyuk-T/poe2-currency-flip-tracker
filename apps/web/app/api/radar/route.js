import { getRadar } from "../../../lib/radar-backend.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const { status, body } = await getRadar(searchParams);
    return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(
      { error: { code: "radar-failed", message: "radar unavailable" } },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
