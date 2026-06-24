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
    return {
      digestId: hour,
      payload: {
        next_change_id: hour + 3600,
        markets: pairs.map((p, j) => {
          const wave = Math.sin((i + j) / 3) * 0.015;
          const mid = p.price * (1 + p.drift * i + wave);
          const spread = 0.018 + Math.abs(Math.sin(i + j)) * 0.012;
          const baseQty = 1000;
          const lowQuote = Math.max(1, Math.round(mid * (1 - spread / 2) * baseQty));
          const highQuote = Math.max(1, Math.round(mid * (1 + spread / 2) * baseQty));
          const volume = Math.round(p.volume * (1 + i / 80 + Math.max(0, Math.sin(i / 2)) * 0.25));
          return {
            league,
            market_id: p.id,
            volume_traded: { [p.base]: volume, [p.quote]: Math.round(volume * mid) },
            lowest_stock: { [p.base]: 40 + i, [p.quote]: Math.round((40 + i) * mid) },
            highest_stock: { [p.base]: 120 + i * 2, [p.quote]: Math.round((120 + i * 2) * mid) },
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
