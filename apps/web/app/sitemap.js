import { popularCurrencies, siteUrl } from "../lib/market.js";
import { guides } from "../lib/guides.js";

// Refresh hourly so per-currency lastmod tracks the latest ingested hour.
export const revalidate = 3600;

export default async function sitemap() {
  const now = new Date();

  // Best-effort: a DB hiccup must not fail the sitemap — degrade to the static
  // pages + popular currencies. Imported dynamically so the DB driver stays out
  // of Next's route-config collection pass.
  let index = null;
  let entries;
  try {
    const { getCurrencyIndex, currencySitemapUrls } = await import("../lib/currency-summary.js");
    index = await getCurrencyIndex();
    entries = currencySitemapUrls(index, { popularIds: popularCurrencies.map((c) => c.id) });
  } catch {
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

  return [
    // Root `/` currently 307-redirects to /poe2 (landing temporarily hidden),
    // so the dashboard is the canonical entry point — don't list the redirect.
    { url: `${siteUrl}/poe2`, lastModified: latest, changeFrequency: "hourly", priority: 1 },
    { url: `${siteUrl}/poe1`, lastModified: latest, changeFrequency: "hourly", priority: 0.9 },
    { url: `${siteUrl}/poe2/currencies`, lastModified: latest, changeFrequency: "hourly", priority: 0.8 },
    { url: `${siteUrl}/guides`, changeFrequency: "monthly", priority: 0.6 },
    ...guides.map((g) => ({ url: `${siteUrl}/guides/${g.slug}`, changeFrequency: "monthly", priority: 0.6 })),
    ...currencyEntries,
  ];
}
