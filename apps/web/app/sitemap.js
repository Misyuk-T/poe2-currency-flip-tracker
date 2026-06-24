import { popularCurrencies, siteUrl } from "../lib/market.js";

export default function sitemap() {
  const now = new Date();
  return [
    { url: siteUrl, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${siteUrl}/poe2`, lastModified: now, changeFrequency: "hourly", priority: 0.9 },
    { url: `${siteUrl}/poe2/currencies`, lastModified: now, changeFrequency: "daily", priority: 0.8 },
    { url: `${siteUrl}/guides/currency-flipping`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    ...popularCurrencies.map((currency) => ({
      url: `${siteUrl}/poe2/currencies/${currency.id}`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.7,
    })),
  ];
}
