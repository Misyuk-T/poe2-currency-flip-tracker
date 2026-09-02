/**
 * Pure sitemaps.org 0.9 serializer (plus the sitemap route's response headers),
 * in the same shape Next's `sitemap.js` metadata route emitted. Both live here
 * rather than in the route file because a `route.js` may only export HTTP
 * methods and segment config, and because the XML shape and the cache policy are
 * worth tests that need no Next runtime.
 */

import { cacheHeader } from "./http.js";

const XML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (char) => XML_ESCAPES[char]);
}

function urlNode({ url, lastModified, changeFrequency, priority }) {
  const lines = [`<loc>${escapeXml(url)}</loc>`];
  if (lastModified) {
    const stamp = lastModified instanceof Date ? lastModified.toISOString() : lastModified;
    lines.push(`<lastmod>${escapeXml(stamp)}</lastmod>`);
  }
  if (changeFrequency) lines.push(`<changefreq>${escapeXml(changeFrequency)}</changefreq>`);
  if (Number.isFinite(priority)) lines.push(`<priority>${priority}</priority>`);
  return `<url>\n${lines.join("\n")}\n</url>`;
}

export function sitemapXml(entries) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries.map(urlNode),
    "</urlset>",
    "",
  ].join("\n");
}

/**
 * Response headers for the sitemap route. The route renders per request
 * (`dynamic = "force-dynamic"`) and leans on the CDN for caching, so the TTL
 * lives here rather than in a `revalidate` export — see the route's own comment
 * for why ISR was abandoned. Lives in this module because a `route.js` may only
 * export HTTP methods and segment config, which would leave it untestable.
 *
 * Deliberately NO stale-while-revalidate on the healthy path. The data is
 * hourly, but a sitemap is fetched roughly once a day: with a long swr window
 * nearly every crawl would be served the previous day's body while the refresh
 * happened behind it, which is the stale-lastmod symptom this change exists to
 * kill, just moved from ISR to the CDN. A plain one-hour TTL means a crawl is
 * at worst an hour behind, and paying one snapshot read per hour is nothing.
 *
 * A degraded render (no currency index behind it — the popular-only fallback)
 * is not cached at all, the same rule `cacheHeader` applies to errors: a thin
 * sitemap must not outlive the outage that produced it, and a resource fetched
 * this rarely gives the database no burst to be shielded from.
 */
export function sitemapResponseHeaders({ degraded = false } = {}) {
  return {
    "Content-Type": "application/xml; charset=utf-8",
    ...cacheHeader(200, { sMaxAge: degraded ? 0 : 3600 }),
  };
}
