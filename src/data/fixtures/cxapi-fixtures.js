/** Deterministic hourly market history for offline Radar development. */

import {
  SCOUT_RUNESHC_CATEGORY_MEDIANS,
  SCOUT_RUNESHC_EXALTED_PRICES,
} from "./poe2scout-runeshc-prices.js";

const DEFAULT_HISTORY_HOURS = 168;

export function buildCxapiFixtures({
  league = "Runes of Aldur",
  endHour = 1_750_000_000,
  items = [],
  anchors = ["exalted"],
  historyHours = DEFAULT_HISTORY_HOURS,
} = {}) {
  const featured = [
    { id: "chaos|exalted", base: "chaos", quote: "exalted", price: 32.747492, drift: 0.002, volume: 7000 },
    { id: "divine|exalted", base: "divine", quote: "exalted", price: 219.35332, drift: 0.006, volume: 1600 },
    { id: "greater-essence-of-haste|exalted", base: "greater-essence-of-haste", quote: "exalted", price: 6, drift: 0.018, volume: 420 },
    { id: "vaal|exalted", base: "vaal", quote: "exalted", price: 3.6522613, drift: -0.009, volume: 900 },
  ];
  const pairs = items.length ? catalogPairs(items, anchors, featured) : featured;
  const hours = Math.max(30, Math.round(historyHours) || DEFAULT_HISTORY_HOURS);
  return Array.from({ length: hours }, (_, i) => {
    const hour = endHour - (hours - 1 - i) * 3600;
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
          const wave = Math.sin((k + j) / 3) * 0.006;
          const dayWave = Math.sin(k / 9 + j * 0.61) * (0.012 + Math.min(Math.abs(p.drift), 0.018) * 1.5);
          const longWave = Math.sin(k / 31 + j * 0.33) * 0.018;
          const pulse = Math.max(0, Math.sin(k / 6 + j * 1.7) - 0.72) * 0.035 * (j % 2 ? -1 : 1);
          const swing = Math.sin(k / 12 + j) * (p.drift * 4);
          const mid = p.price * (1 + swing + wave + dayWave + longWave + pulse);
          const spread = 0.018 + Math.abs(Math.sin(k + j)) * 0.012;
          const baseQty = 1000;
          const lowQuote = Math.max(1, Math.round(mid * (1 - spread / 2) * baseQty));
          const highQuote = Math.max(1, Math.round(mid * (1 + spread / 2) * baseQty));
          const volume = Math.round(p.volume * (1 + Math.max(0, Math.sin(k / 2 + j)) * 0.3 + Math.abs(pulse) * 6));
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
      const price = scoutPriceInAnchor(item, anchor, seed);
      pairs.set(key, {
        id: `${target}|${anchor}`,
        base: target,
        quote: anchor,
        price,
        drift: ((seed % 21) - 10) / 1000,
        volume: scoutVolume(item, seed),
      });
    }
  }
  return [...pairs.values()];
}

function scoutPriceInAnchor(item, anchor, seed) {
  const target = item.id;
  const targetInExalted = priceInExalted(item, seed);
  const anchorInExalted = anchor === "exalted" ? 1 : priceInExalted({ id: anchor, category: "Currency" }, hash(anchor));
  if (!positive(targetInExalted) || !positive(anchorInExalted)) return 10 ** (-2 + (seed % 501) / 100);
  return targetInExalted / anchorInExalted;
}

function priceInExalted(item, seed) {
  if (item.id === "exalted") return 1;
  const exact = SCOUT_RUNESHC_EXALTED_PRICES[item.id];
  if (positive(exact)) return exact;
  const median = SCOUT_RUNESHC_CATEGORY_MEDIANS[item.category];
  if (!positive(median)) return null;
  const offset = ((seed % 101) - 50) / 100;
  return median * (1 + offset * 0.45);
}

function scoutVolume(item, seed) {
  const categoryBase = {
    Currency: 7_000,
    Fragments: 2_800,
    Runes: 2_400,
    Essences: 1_800,
    Breach: 1_500,
    Delirium: 1_200,
    Ritual: 900,
    Expedition: 850,
    "Uncut Gems": 800,
    Verisium: 750,
    Vaal: 650,
    "Lineage Support Gems": 500,
    "Abyssal Bones": 420,
    Waystones: 2_000,
  }[item.category] ?? 400;
  return Math.max(25, Math.round(categoryBase * (0.7 + (seed % 61) / 100)));
}

function positive(value) {
  return Number.isFinite(value) && value > 0;
}

function canonical(a, b) {
  return [a, b].sort().join("|");
}

function hash(value) {
  let h = 2166136261;
  for (const ch of value) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}
