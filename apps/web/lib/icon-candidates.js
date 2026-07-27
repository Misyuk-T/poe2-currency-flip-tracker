/**
 * Icon fallback chains, built from live data rather than a curated list.
 *
 * Every radar row carries a `targetIcon`, but a slice of them are URLs derived
 * from a RePoE art path that GGG's CDN 404s (verified: no extension, realm or
 * host variant resolves those — the art path is wrong upstream, so there is no
 * URL rule that fixes it). Hardcoding the affected items would go stale on the
 * next league, so instead each row falls back to a working sibling from its own
 * category: whatever the API returns for a new league is handled automatically.
 *
 * The renderer walks the chain, stepping on image load errors, so which
 * candidate actually resolves is decided by the browser at paint time.
 */

export const MAX_ICON_CANDIDATES = 5;

/** category -> up to MAX_ICON_CANDIDATES distinct member icons. */
export function categoryIconMap(rows) {
  const map = new Map();
  for (const row of rows ?? []) {
    if (!row?.targetIcon) continue;
    const name = row.category || "Other";
    const candidates = map.get(name) ?? [];
    if (candidates.length < MAX_ICON_CANDIDATES && !candidates.includes(row.targetIcon)) {
      candidates.push(row.targetIcon);
      map.set(name, candidates);
    }
  }
  return map;
}

/**
 * Ordered fallbacks for one row: its own icon, then siblings from its category,
 * then an optional curated glyph for that category. Duplicates are dropped so a
 * failing icon is never retried.
 */
export function iconCandidatesForRow(row, categoryIcons, curatedByCategory = {}) {
  const category = row?.category || "Other";
  const chain = [
    row?.targetIcon,
    ...(categoryIcons?.get(category) ?? []),
    curatedByCategory[category],
  ].filter(Boolean);
  return [...new Set(chain)];
}

/** Ordered fallbacks for a sidebar category chip. */
export function iconCandidatesForCategory(category, categoryIcons, curatedByCategory = {}) {
  const chain = [curatedByCategory[category], ...(categoryIcons?.get(category) ?? [])].filter(Boolean);
  return [...new Set(chain)];
}
