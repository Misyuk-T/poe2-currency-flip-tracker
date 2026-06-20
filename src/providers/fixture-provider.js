/**
 * Fixture MarketProvider — deterministic, offline. Enabled by default so all
 * calculations and UI work without live access. Merges per-(have,want) fixture
 * listings into a single GGG-shaped response, supporting batched `want`.
 *
 * Optional `wobble` applies a gentle, time-based oscillation to prices so the
 * trend charts move in a demo. It only ever scales the ANCHOR-side amount, so
 * bundle sizes (the non-anchor side) stay integer. Off by default (tests stay
 * deterministic); enabled by the server wiring.
 */

import { EXCHANGE_FIXTURES, fixtureWobble } from "../data/fixtures/exchange-fixtures.js";

/**
 * @param {{ anchorCurrency?: string }} [config]
 * @param {{ fixtures?: Record<string, any[]>, freshenIndexed?: boolean, wobble?: boolean }} [opts]
 */
export function createFixtureProvider(config = {}, opts = {}) {
  const fixtures = opts.fixtures ?? EXCHANGE_FIXTURES;
  const freshenIndexed = opts.freshenIndexed ?? true;
  const wobble = opts.wobble ?? false;
  const anchor = config.anchorCurrency ?? "exalted";

  return {
    mode: "fixture",
    label: "Fixture data (offline, not live)",
    async fetchExchange({ have, want }) {
      const haveId = have[0];
      const result = {};
      const stamp = new Date().toISOString();
      const now = Date.now();
      const isEntry = haveId === anchor; // anchor sits on the exchange side
      for (const target of want) {
        const key = `${haveId}>${target}`;
        const listings = fixtures[key] ?? [];
        const currency = isEntry ? target : haveId; // the non-anchor currency
        const factor = wobble ? (isEntry ? fixtureWobble(currency, now) : 1 / fixtureWobble(currency, now)) : 1;
        for (const raw of listings) {
          let entry = freshenIndexed ? freshen(raw, stamp) : raw;
          if (factor !== 1) entry = scaleAnchorSide(entry, anchor, factor);
          result[entry.id] = entry;
        }
      }
      return { id: `fixture:${have.join(",")}>${want.join(",")}`, result };
    },
  };
}

function freshen(raw, stamp) {
  return { ...raw, listing: { ...raw.listing, indexed: stamp } };
}

/** Scale only the amount of the side whose currency === anchor (price-only knob). */
function scaleAnchorSide(raw, anchor, factor) {
  const offers = raw.listing.offers.map((o) => {
    const next = { exchange: { ...o.exchange }, item: { ...o.item } };
    if (next.exchange.currency === anchor) next.exchange.amount *= factor;
    else if (next.item.currency === anchor) next.item.amount *= factor;
    return next;
  });
  return { ...raw, listing: { ...raw.listing, offers } };
}
