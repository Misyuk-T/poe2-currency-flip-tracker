import { popularCurrencies, siteUrl } from "../../lib/market.js";
import { guides } from "../../lib/guides.js";
import { sitemapXml, sitemapResponseHeaders } from "../../lib/sitemap-xml.js";

// A route handler, not the app-router `sitemap.js` metadata convention: metadata
// routes are emitted as build-time static output, which froze every lastmod at
// the deploy timestamp. The handler that replaced it carried `revalidate = 3600`
// and froze just as hard: on Vercel, ISR revalidation for this route never
// fired. Runtime logs showed zero invocations across an hour of requests, every
// response came back `x-vercel-cache: HIT`, and the cached body outlived a
// deployment — lastmod stuck at 2026-08-29T19:00Z while /poe2/currencies, which
// reads the very same index, rendered the current hour.
//
// So the ISR path is gone: render per request and let the CDN hold the copy,
// via explicit cache headers (see `sitemapResponseHeaders`) — the same mechanism
// the /api read routes use, where the edge TTL demonstrably works.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Rendering per request puts the snapshot read on the request path, and its
// fallback (`readCandleWindow`) is the slow multi-day scan. A lambda timeout is
// not a JS throw, so the try/catch below cannot degrade it — the default limit
// would hand Googlebot a 5xx instead of a thin sitemap. Same budget as
// /api/radar, and warm reads finish far inside it.
export const maxDuration = 30;

export async function GET() {
  const now = new Date();

  // Best-effort: a DB hiccup must not fail the sitemap — degrade to the static
  // pages + popular currencies. Imported dynamically so the DB driver stays out
  // of Next's route-config collection pass.
  let index = null;
  let entries;
  let degraded = false;
  try {
    const { getCurrencyIndex, currencySitemapUrls } = await import("../../lib/currency-summary.js");
    index = await getCurrencyIndex();
    // A null index is the same degraded output as a throw (no database, no
    // stored data): only the hardcoded popular pages get listed.
    degraded = index === null;
    entries = currencySitemapUrls(index, { popularIds: popularCurrencies.map((c) => c.id) });
  } catch (error) {
    console.error("[sitemap] currency index read failed; listing popular only", {
      errorName: error?.name ?? "Error",
      errorCode: error?.code ?? null,
      errorMessage: error?.message ?? String(error),
    });
    index = null;
    degraded = true;
    entries = popularCurrencies.map((c) => ({ id: c.id, lastModifiedMs: null }));
  }

  const latest = index?.latestCompletedHour ? new Date(index.latestCompletedHour) : now;

  const currencyEntries = entries.map(({ id, lastModifiedMs }) => ({
    url: `${siteUrl}/poe2/currencies/${id}`,
    // Only emit lastModified when real data backs the page; pages without data
    // stay stable (no churning timestamp) and advertise a slower change cadence.
    ...(lastModifiedMs ? { lastModified: new Date(lastModifiedMs) } : {}),
    changeFrequency: lastModifiedMs ? "hourly" : "daily",
    priority: 0.7,
  }));

  const body = sitemapXml([
    // Root `/` 308-redirects to /poe2 (landing hidden), so the dashboard is the
    // canonical entry point — don't list the redirect.
    { url: `${siteUrl}/poe2`, lastModified: latest, changeFrequency: "hourly", priority: 1 },
    { url: `${siteUrl}/poe1`, lastModified: latest, changeFrequency: "hourly", priority: 0.9 },
    { url: `${siteUrl}/poe2/currencies`, lastModified: latest, changeFrequency: "hourly", priority: 0.8 },
    { url: `${siteUrl}/guides`, changeFrequency: "monthly", priority: 0.6 },
    ...guides.map((g) => ({ url: `${siteUrl}/guides/${g.slug}`, changeFrequency: "monthly", priority: 0.6 })),
    ...currencyEntries,
  ]);

  return new Response(body, { headers: sitemapResponseHeaders({ degraded }) });
}
