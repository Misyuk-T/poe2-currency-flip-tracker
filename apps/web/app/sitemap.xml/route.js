import { popularCurrencies, siteUrl } from "../../lib/market.js";
import { guides } from "../../lib/guides.js";
import { sitemapXml } from "../../lib/sitemap-xml.js";

// A route handler, not the app-router `sitemap.js` metadata convention: metadata
// routes are emitted as build-time static output and don't honor `revalidate`,
// which froze every lastmod at the deploy timestamp. Deliberately no
// `dynamic = "force-static"` here — if revalidation ever failed to kick in that
// would reintroduce the exact freeze this replaces, whereas falling back to
// per-request rendering only costs one snapshot read.
export const revalidate = 3600;

export async function GET() {
  const now = new Date();

  // Best-effort: a DB hiccup must not fail the sitemap — degrade to the static
  // pages + popular currencies. Imported dynamically so the DB driver stays out
  // of Next's route-config collection pass.
  let index = null;
  let entries;
  try {
    const { getCurrencyIndex, currencySitemapUrls } = await import("../../lib/currency-summary.js");
    index = await getCurrencyIndex();
    entries = currencySitemapUrls(index, { popularIds: popularCurrencies.map((c) => c.id) });
  } catch (error) {
    console.error("[sitemap] currency index read failed; listing popular only", {
      errorName: error?.name ?? "Error",
      errorCode: error?.code ?? null,
      errorMessage: error?.message ?? String(error),
    });
    index = null;
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

  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
