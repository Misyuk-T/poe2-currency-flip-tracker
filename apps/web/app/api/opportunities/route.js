import { cacheHeader } from "../../../lib/http.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Server-side executable-book opportunities are intentionally NOT part of the
// hosted serverless build (the full order-book ladder is never persisted, and
// the source is an unapproved endpoint). The radar surface is the product here.
// Kept as an explicit, honest response rather than a 404 so clients get a reason.
// The payload is static, so it can sit on the CDN for a long time.
export async function GET() {
  return Response.json(
    {
      state: "disabled",
      reason: "Server-side executable-book opportunities are not available in the hosted build.",
      features: { liveBooks: false },
    },
    { status: 200, headers: cacheHeader(200, { sMaxAge: 3600, swr: 86400 }) },
  );
}
