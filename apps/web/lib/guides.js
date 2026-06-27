// Registry of guide pages — the /guides hub and the sitemap both read this so a
// new guide is listed everywhere by adding one entry (plus its page).
export const guides = [
  {
    slug: "currency-flipping",
    title: "PoE2 currency flipping",
    blurb: "Read hourly ranges as context, verify the live price, and pick a holding horizon that matches the trade.",
  },
  {
    slug: "divine-to-exalted-ratio",
    title: "Divine to Exalted ratio, explained",
    blurb: "What the Divine/Exalted ratio is, why it moves, and how to read it before pricing a big trade.",
  },
  {
    slug: "poe2-currency-exchange",
    title: "PoE2 currency exchange, explained",
    blurb: "How currencies are priced against an anchor, what liquidity and spread mean, and how to use the data honestly.",
  },
];

export function guideBySlug(slug) {
  return guides.find((g) => g.slug === slug) ?? null;
}
