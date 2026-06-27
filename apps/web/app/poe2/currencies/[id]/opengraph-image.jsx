import { ogImageResponse, OG_SIZE } from "../../../../lib/og.jsx";
import { currencyName, popularCurrencies } from "../../../../lib/market.js";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "PoE2 currency market tracker";

// Prebuild the popular currencies' cards; others render on demand.
export function generateStaticParams() {
  return popularCurrencies.map((currency) => ({ id: currency.id }));
}

export default async function Image({ params }) {
  const { id } = await params;
  return ogImageResponse({
    eyebrow: "PoE2 currency market",
    title: currencyName(id),
    tagline: "Hourly market ranges, 24h moves and conservative entry/exit planning.",
  });
}
