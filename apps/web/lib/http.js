/**
 * Cache-Control for the serverless read routes. Successful reads are cached at
 * the Vercel CDN edge with `stale-while-revalidate` so a warm edge absorbs
 * bursts and shields Postgres; the data is hourly, so a short edge TTL stays
 * fresh. Anything that is not a clean 200 (503 no-db, 4xx, 5xx) stays
 * `no-store` — we never cache an error or a degraded response.
 *
 * Edge caching is driven by `Vercel-CDN-Cache-Control` (and the standard
 * `CDN-Cache-Control`) rather than a bare `Cache-Control: s-maxage`, because the
 * routes are `dynamic = "force-dynamic"` and Next does not reliably forward
 * `s-maxage` to Vercel's CDN for forced-dynamic handlers. The browser header is
 * `must-revalidate` so clients always re-check while the edge serves the cached
 * copy. (Vercel consumes the CDN directives and does not pass them to clients.)
 *
 * @param {number} status   the response status being returned
 * @param {{ sMaxAge?: number, swr?: number }} [opts]
 */
export function cacheHeader(status, { sMaxAge = 0, swr = 0 } = {}) {
  if (status !== 200 || sMaxAge <= 0) return { "Cache-Control": "no-store" };
  const swrPart = swr > 0 ? `, stale-while-revalidate=${swr}` : "";
  const edge = `public, s-maxage=${sMaxAge}${swrPart}`;
  return {
    "Cache-Control": "public, max-age=0, must-revalidate",
    "CDN-Cache-Control": edge,
    "Vercel-CDN-Cache-Control": edge,
  };
}
