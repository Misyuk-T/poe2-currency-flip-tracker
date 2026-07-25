/**
 * Tier-aware grouping for the market table.
 *
 * PoE2 names its upgrade tiers with a prefix: "Regal Orb" / "Greater Regal Orb"
 * / "Perfect Regal Orb", "Lesser Jeweller's Orb", and so on. Sorting purely by
 * name scatters those across the alphabet (G…, P…, R…) and sorting purely by
 * price scatters them by value, so neither lets you see one item's tiers at a
 * glance. Stripping the prefix recovers the family and keeps them adjacent.
 */

const TIER_PREFIXES = [
  { prefix: "lesser ", rank: 0 },
  { prefix: "greater ", rank: 2 },
  { prefix: "perfect ", rank: 3 },
];

/** `"Greater Regal Orb"` -> `{ family: "regal orb", tier: 2 }`. Base tier is 1. */
export function itemFamily(name) {
  const label = String(name ?? "").trim();
  const lower = label.toLowerCase();
  for (const { prefix, rank } of TIER_PREFIXES) {
    if (lower.startsWith(prefix)) {
      return { family: lower.slice(prefix.length), tier: rank };
    }
  }
  return { family: lower, tier: 1 };
}

/**
 * Group tier variants of the same item together, ordering families by their
 * most valuable member (so the meaningful markets stay near the top) and, in
 * each family, running lesser -> base -> greater -> perfect.
 */
export function sortByFamily(rows) {
  const strongest = new Map();
  const decorated = (rows ?? []).map((row, index) => {
    const { family, tier } = itemFamily(row.targetName ?? row.target);
    const price = Number.isFinite(row.reference) ? row.reference : -Infinity;
    if (!strongest.has(family) || price > strongest.get(family)) strongest.set(family, price);
    return { row, family, tier, index };
  });
  return decorated
    .sort((a, b) => {
      const byFamilyValue = (strongest.get(b.family) ?? -Infinity) - (strongest.get(a.family) ?? -Infinity);
      // -Infinity - -Infinity is NaN, so unpriced families compare equal here
      // and fall through to the name/tier tiebreakers below.
      if (byFamilyValue) return byFamilyValue;
      if (a.family !== b.family) return a.family.localeCompare(b.family);
      return a.tier - b.tier || a.index - b.index;
    })
    .map((entry) => entry.row);
}
