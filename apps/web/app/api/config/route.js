import { getConfig } from "../../../lib/radar-backend.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { status, body } = await getConfig();
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
