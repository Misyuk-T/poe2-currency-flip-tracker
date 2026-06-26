import { getConfig } from "../../../lib/radar-backend.js";
import { cacheHeader } from "../../../lib/http.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { status, body } = await getConfig();
  return Response.json(body, { status, headers: cacheHeader(status, { sMaxAge: 300, swr: 3600 }) });
}
