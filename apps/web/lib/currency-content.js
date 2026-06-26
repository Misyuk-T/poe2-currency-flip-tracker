/**
 * Hand-written, genuinely distinct copy per popular currency: what the currency
 * does in Path of Exile 2 and how it tends to trade, plus a short FAQ. This is
 * editorial game/market context — it never states a price, probability or any
 * fabricated figure (live numbers come from the data layer, clearly labelled).
 *
 * Currencies without an entry render the generic methodology copy instead; the
 * page still differentiates them by their real, per-currency market data.
 */
export const currencyContent = {
  divine: {
    uses:
      "The Divine Orb rerolls the numeric values of the modifiers already on an item, so it is the currency endgame players spend to perfect high-end gear. Because each orb carries a lot of value, Divine sits at the top of the currency stack and doubles as a high-denomination store of value for large trades.",
    trading:
      "It trades thinner than the bulk currencies — fewer listings and larger steps between prices — so a stale quote costs more here than almost anywhere else. Big-ticket items are frequently priced directly in Divine.",
    faq: [
      {
        q: "What is the Divine Orb used for in PoE2?",
        a: "It rerolls the values of an item's existing modifiers, letting crafters push near-finished gear toward its best possible rolls. It is also widely used as a high-value trading currency.",
      },
      {
        q: "Is the Divine Orb good for flipping?",
        a: "Divine is a thin, high-value market: spreads can be wide and a single trade ties up a lot of capital, so an out-of-date price is the main risk. Compare the latest hourly range with the current in-game price before committing.",
      },
    ],
  },
  exalted: {
    uses:
      "Exalted Orbs add a new random modifier to a rare item — the everyday crafting action behind most gear progression — which keeps demand constant. In Path of Exile 2 the Exalted Orb is also the practical unit of account: most prices are quoted in Exalted, so it behaves like the market's base currency.",
    trading:
      "Deep, liquid and quick to fill in both directions, which is exactly why this tracker uses it as the anchor for measuring everything else.",
    faq: [
      {
        q: "What is the Exalted Orb used for in PoE2?",
        a: "It adds one new random modifier to a rare item, the core step in upgrading gear. Its constant use and deep market also make it the default currency players quote prices in.",
      },
      {
        q: "Why is everything priced in Exalted Orbs?",
        a: "Because the Exalted market is the most liquid and stable, it makes a reliable yardstick — small, frequent trades fill quickly, so a price expressed in Exalted is easy to act on.",
      },
    ],
  },
  chaos: {
    uses:
      "The Chaos Orb reforges a single modifier on a rare item — removing one and adding another — a targeted crafting step with steady, everyday demand. Because so many players use it, the Chaos market is a reasonable read on broad currency demand.",
    trading:
      "A deep, actively-traded market where spreads are usually tight, so any edge comes from timing rather than size.",
    faq: [
      {
        q: "What is the Chaos Orb used for in PoE2?",
        a: "It swaps one modifier on a rare item for a new random one, a precise way to fix a single unwanted roll without rerolling the whole item.",
      },
      {
        q: "Is the Chaos Orb liquid enough to flip?",
        a: "Yes — it is one of the more actively-traded currencies, so listings fill quickly. Tight spreads mean profit usually comes from reacting to short-term moves rather than large positions.",
      },
    ],
  },
  vaal: {
    uses:
      "Vaal Orbs corrupt an item for an unpredictable outcome — a high-variance gamble that players keep buying in volume. That constant churn makes Vaal one of the livelier short-term markets.",
    trading:
      "Frequent listings and brisk short-term movement; prices can swing on demand spikes around new content or popular crafting strategies.",
    faq: [
      {
        q: "What is the Vaal Orb used for in PoE2?",
        a: "It corrupts an item, applying a random and irreversible effect. The gamble is popular for trying to push items beyond their normal limits.",
      },
      {
        q: "Why does the Vaal Orb price move so much?",
        a: "Demand is driven by crafting gambles that come and go with the meta, so short-term ranges are wider than for steadier bulk currencies. The hourly range here helps gauge whether the current price is unusual.",
      },
    ],
  },
  "greater-exalted-orb": {
    uses:
      "The Greater Exalted Orb is a higher-tier Exalted variant used to push stronger modifiers onto endgame gear, so demand concentrates among players crafting top-end items.",
    trading:
      "A higher unit value with thinner depth than the standard Exalted market — hourly range and liquidity matter more here than the raw spread.",
    faq: [
      {
        q: "What is the Greater Exalted Orb used for in PoE2?",
        a: "It adds a modifier aimed at higher tiers than a standard Exalted Orb, making it a tool for crafting stronger endgame items.",
      },
      {
        q: "How is it different from a normal Exalted Orb for trading?",
        a: "It is worth more and trades less often, so the market is thinner. Watch the hourly range and freshness closely, since a single stale quote moves the price more.",
      },
    ],
  },
  "fracturing-orb": {
    uses:
      "The Fracturing Orb locks one modifier on an item so it survives further crafting — a powerful, expensive step reserved for high-end gear. Its niche, endgame use keeps the market small but valuable.",
    trading:
      "An expensive, thin market where a stale price can be costly; treat the hourly range as a sanity check before committing.",
    faq: [
      {
        q: "What is the Fracturing Orb used for in PoE2?",
        a: "It fractures (locks) a chosen modifier on an item so that modifier stays fixed while the rest is recrafted — a key tool for deterministic high-end crafting.",
      },
      {
        q: "Is the Fracturing Orb worth flipping?",
        a: "It is high-value and trades infrequently, so capital and price staleness are the main risks. Use the hourly range and sample count to judge whether a quote is reliable before trading.",
      },
    ],
  },
};

export function contentFor(id) {
  return currencyContent[id] ?? null;
}
