/**
 * Cache-Control for the serverless read routes. Successful reads are cacheable
 * at the CDN edge (`s-maxage`) with `stale-while-revalidate` so a warm edge
 * absorbs bursts and shields Postgres; the data is hourly, so a short edge TTL
 * is plenty fresh. Anything that is not a clean 200 (503 no-db, 4xx, 5xx) stays
 * `no-store` — we never cache an error or a degraded response.
 *
 * @param {number} status   the response status being returned
 * @param {{ sMaxAge?: number, swr?: number }} [opts]
 */
export function cacheHeader(status, { sMaxAge = 0, swr = 0 } = {}) {
  if (status !== 200 || sMaxAge <= 0) return { "Cache-Control": "no-store" };
  const swrPart = swr > 0 ? `, stale-while-revalidate=${swr}` : "";
  return { "Cache-Control": `public, s-maxage=${sMaxAge}${swrPart}` };
}
