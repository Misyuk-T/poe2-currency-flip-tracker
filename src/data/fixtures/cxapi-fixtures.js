/** Deterministic 30-hour hourly market history for offline Radar development. */

export function buildCxapiFixtures({ league = "Runes of Aldur", endHour = 1_750_000_000, items = [], anchors = ["exalted"] } = {}) {
  const featured = [
    { id: "chaos|exalted", base: "chaos", quote: "exalted", price: 0.11, drift: 0.002, volume: 7000 },
    { id: "divine|exalted", base: "divine", quote: "exalted", price: 205, drift: 0.006, volume: 1600 },
    { id: "greater-essence-of-haste|exalted", base: "greater-essence-of-haste", quote: "exalted", price: 24, drift: 0.018, volume: 420 },
    { id: "vaal|exalted", base: "vaal", quote: "exalted", price: 0.54, drift: -0.009, volume: 900 },
  ];
  const pairs = items.length ? catalogPairs(items, anchors, featured) : featured;
  return Array.from({ length: 30 }, (_, i) => {
    const hour = endHour - (29 - i) * 3600;
    // Key the motion on the ABSOLUTE completed-hour index, not the rolling window
    // index i. i always tops out at 29 for the newest hour, so when an ingester
    // appends one new hour at a time (on-conflict-do-nothing) an i-based series
    // would flatten; an absolute, bounded oscillation keeps it moving forever.
    const k = Math.round(hour / 3600);
    return {
      digestId: hour,
      payload: {
        next_change_id: hour + 3600,
        markets: pairs.map((p, j) => {
          const wave = Math.sin((k + j) / 3) * 0.015; // fast wiggle
          const swing = Math.sin(k / 12 + j) * (p.drift * 20); // slow bounded ±drift oscillation
          const mid = p.price * (1 + swing + wave);
          const spread = 0.018 + Math.abs(Math.sin(k + j)) * 0.012;
          const baseQty = 1000;
          const lowQuote = Math.max(1, Math.round(mid * (1 - spread / 2) * baseQty));
          const highQuote = Math.max(1, Math.round(mid * (1 + spread / 2) * baseQty));
          const volume = Math.round(p.volume * (1 + Math.max(0, Math.sin(k / 2 + j)) * 0.3));
          const stock = 40 + (k % 40);
          return {
            league,
            market_id: p.id,
            volume_traded: { [p.base]: volume, [p.quote]: Math.round(volume * mid) },
            lowest_stock: { [p.base]: stock, [p.quote]: Math.round(stock * mid) },
            highest_stock: { [p.base]: stock * 3, [p.quote]: Math.round(stock * 3 * mid) },
            lowest_ratio: { [p.base]: baseQty, [p.quote]: lowQuote },
            highest_ratio: { [p.base]: baseQty, [p.quote]: highQuote },
          };
        }),
      },
    };
  });
}

function catalogPairs(items, anchors, featured) {
  const overrides = new Map(featured.map((p) => [canonical(p.base, p.quote), p]));
  const pairs = new Map();
  for (const anchor of anchors) {
    for (const item of items) {
      const target = item.id;
      if (!target || target === anchor) continue;
      const key = canonical(target, anchor);
      if (pairs.has(key)) continue;
      const special = overrides.get(key);
      if (special) {
        pairs.set(key, special);
        continue;
      }
      const seed = hash(`${target}|${anchor}`);
      pairs.set(key, {
        id: `${target}|${anchor}`,
        base: target,
        quote: anchor,
        price: 10 ** (-2 + (seed % 501) / 100),
        drift: ((seed % 21) - 10) / 1000,
        volume: 100 + (seed % 12_000),
      });
    }
  }
  return [...pairs.values()];
}

function canonical(a, b) {
  return [a, b].sort().join("|");
}

function hash(value) {
  let h = 2166136261;
  for (const ch of value) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}
