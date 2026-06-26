import { popularCurrencies, siteUrl } from "../lib/market.js";

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
    entries = currencySitemapUrls(index, { popularIds: popularCurrencies.map((c) => c.id), nowMs: now.getTime() });
  } catch {
    index = null;
    entries = popularCurrencies.map((c) => ({ id: c.id, lastModifiedMs: now.getTime() }));
  }

  const latest = index?.latestCompletedHour ? new Date(index.latestCompletedHour) : now;

  const currencyEntries = entries.map(({ id, lastModifiedMs }) => ({
    url: `${siteUrl}/poe2/currencies/${id}`,
    lastModified: new Date(lastModifiedMs),
    changeFrequency: "hourly",
    priority: 0.7,
  }));

  return [
    { url: siteUrl, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${siteUrl}/poe2`, lastModified: latest, changeFrequency: "hourly", priority: 0.9 },
    { url: `${siteUrl}/poe2/currencies`, lastModified: latest, changeFrequency: "hourly", priority: 0.8 },
    { url: `${siteUrl}/guides/currency-flipping`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    ...currencyEntries,
  ];
}
