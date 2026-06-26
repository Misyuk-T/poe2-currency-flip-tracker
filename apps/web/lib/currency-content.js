/**
 * Hand-written, genuinely distinct copy per popular currency: what the currency
 * does in Path of Exile 2 and how it tends to trade, plus a short FAQ. This is
 * editorial game context, deliberately written as general tendencies — it never
 * states a price, range, probability or any fabricated figure, and it does not
 * assert measured market behaviour. Live numbers come from the data layer,
 * clearly labelled; this copy only frames how each currency is commonly used.
 *
 * Currencies without an entry render the generic methodology copy instead; the
 * page still differentiates them by their real, per-currency market data.
 */
export const currencyContent = {
  divine: {
    uses:
      "The Divine Orb rerolls the numeric values of the modifiers already on an item, so it is the currency endgame players spend to perfect high-end gear. Because each orb carries a lot of value, Divine sits at the top of the currency stack and is commonly used as a high-denomination store of value for large trades.",
    trading:
      "Its high unit value means it generally tends to trade thinner than the bulk currencies, so an out-of-date quote tends to cost more here than elsewhere. Big-ticket items are frequently priced directly in Divine.",
    faq: [
      {
        q: "What is the Divine Orb used for in PoE2?",
        a: "It rerolls the values of an item's existing modifiers, letting crafters push near-finished gear toward its best possible rolls. It is also widely used as a high-value trading currency.",
      },
      {
        q: "Is the Divine Orb good for flipping?",
        a: "Divine tends to be a thin, high-value market: a single trade ties up a lot of capital, so an out-of-date price is the main risk. Compare the latest hourly range with the current in-game price before committing.",
      },
    ],
  },
  exalted: {
    uses:
      "Exalted Orbs add a new random modifier to a rare item — the everyday crafting action behind most gear progression, so players reach for them constantly. In Path of Exile 2 the Exalted Orb is also the practical unit of account: most prices are quoted in Exalted, so it behaves like the market's base currency.",
    trading:
      "It generally fills quickly in both directions, which is exactly why this tracker uses it as the anchor for measuring everything else.",
    faq: [
      {
        q: "What is the Exalted Orb used for in PoE2?",
        a: "It adds one new random modifier to a rare item, the core step in upgrading gear. Its constant use also makes it the currency players most often quote prices in.",
      },
      {
        q: "Why is everything priced in Exalted Orbs?",
        a: "Players generally treat Exalted as the most convenient yardstick: it is in constant demand and trades in small, frequent amounts, so a price expressed in Exalted is easy to act on.",
      },
    ],
  },
  chaos: {
    uses:
      "The Chaos Orb reforges a single modifier on a rare item — removing one and adding another — a targeted crafting step with steady, everyday demand. Because it is used so widely, Chaos demand is often treated as a rough read on broader currency activity.",
    trading:
      "It is a staple, widely-used crafting currency, so any edge usually comes from timing rather than from large positions.",
    faq: [
      {
        q: "What is the Chaos Orb used for in PoE2?",
        a: "It swaps one modifier on a rare item for a new random one, a precise way to fix a single unwanted roll without rerolling the whole item.",
      },
      {
        q: "Is the Chaos Orb liquid enough to flip?",
        a: "Chaos is one of the most widely-used crafting currencies, so it generally sees steady trading interest. Any profit usually comes from reacting to short-term moves rather than holding large positions.",
      },
    ],
  },
  vaal: {
    uses:
      "Vaal Orbs corrupt an item for an unpredictable outcome — a high-variance gamble that players keep buying in volume. That steady demand tends to keep Vaal among the livelier short-term markets.",
    trading:
      "Short-term movement tends to be brisk; prices can swing on demand spikes around new content or popular crafting strategies.",
    faq: [
      {
        q: "What is the Vaal Orb used for in PoE2?",
        a: "It corrupts an item, applying a random and irreversible effect. The gamble is popular for trying to push items beyond their normal limits.",
      },
      {
        q: "Why does the Vaal Orb price move so much?",
        a: "Demand is driven by crafting gambles that come and go with the meta, so short-term ranges tend to be wider than for steadier bulk currencies. The hourly range here helps gauge whether the current price is unusual.",
      },
    ],
  },
  "greater-exalted-orb": {
    uses:
      "The Greater Exalted Orb is a higher-tier Exalted variant used to push stronger modifiers onto endgame gear, so demand concentrates among players crafting top-end items.",
    trading:
      "Its higher unit value means it tends to trade less often than the standard Exalted market, so hourly range and freshness usually matter more here than the raw spread.",
    faq: [
      {
        q: "What is the Greater Exalted Orb used for in PoE2?",
        a: "It adds a modifier aimed at higher tiers than a standard Exalted Orb, making it a tool for crafting stronger endgame items.",
      },
      {
        q: "How is it different from a normal Exalted Orb for trading?",
        a: "It is worth more and tends to trade less often, so watch the hourly range and freshness closely — a single stale quote can move the price more.",
      },
    ],
  },
  "fracturing-orb": {
    uses:
      "The Fracturing Orb locks one modifier on an item so it survives further crafting — a powerful, expensive step reserved for high-end gear. Its niche, endgame use tends to keep the market small but valuable.",
    trading:
      "An expensive, niche currency where a stale price can be costly, so treat the hourly range as a sanity check before committing.",
    faq: [
      {
        q: "What is the Fracturing Orb used for in PoE2?",
        a: "It fractures (locks) a chosen modifier on an item so that modifier stays fixed while the rest is recrafted — a key tool for deterministic high-end crafting.",
      },
      {
        q: "Is the Fracturing Orb worth flipping?",
        a: "It is high-value and tends to trade infrequently, so capital and price staleness are the main risks. Use the hourly range and sample count to judge whether a quote is reliable before trading.",
      },
    ],
  },
};

export function contentFor(id) {
  return currencyContent[id] ?? null;
}
