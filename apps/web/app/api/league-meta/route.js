import { cacheHeader } from "../../../lib/http.js";
import { POE1_LEGACY_LEAGUES_URL, selectPoe1LeagueMeta } from "../../../lib/league-meta.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

const CACHE_SECONDS = 6 * 60 * 60;

export async function GET(request) {
  const url = new URL(request.url);
  const game = url.searchParams.get("game");
  const league = url.searchParams.get("league")?.trim();

  // GGG silently ignores realm=poe2 on this legacy endpoint and returns PoE 1
  // PC leagues, so never use it for PoE 2.
  if (game !== "poe1") {
    return Response.json(
      { available: false },
      { status: 200, headers: cacheHeader(200, { sMaxAge: CACHE_SECONDS, swr: 86400 }) },
    );
  }
  if (!league || league.length > 120) {
    return Response.json({ error: "A valid league is required." }, { status: 400, headers: cacheHeader(400) });
  }

  try {
    const upstream = await fetch(POE1_LEGACY_LEAGUES_URL, {
      headers: {
        Accept: "application/json",
        "User-Agent": "ExileRadar/1.0 (+https://exileradar.com)",
      },
      signal: AbortSignal.timeout(5_000),
      next: { revalidate: CACHE_SECONDS },
    });
    if (!upstream.ok) throw new Error(`GGG leagues request failed: ${upstream.status}`);

    const entries = await upstream.json();
    if (!Array.isArray(entries)) throw new Error("GGG leagues response was not an array");

    const body = selectPoe1LeagueMeta(entries, league);
    return Response.json(body, {
      status: 200,
      headers: cacheHeader(200, { sMaxAge: CACHE_SECONDS, swr: 86400 }),
    });
  } catch (error) {
    console.warn("Optional PoE 1 league metadata unavailable:", error);
    return Response.json(
      { available: false },
      { status: 502, headers: cacheHeader(502) },
    );
  }
}
