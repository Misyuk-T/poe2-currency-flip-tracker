/**
 * Pick which Metadata id owns a trade short id when several share a name.
 *
 * The identity build joins RePoE base items to the trade catalog by display
 * name, on the assumption that names are unique. They are not: 17 PoE2 names
 * are carried by two or three Metadata ids — a quest copy, a crafting-bench
 * copy, or a superseded PoE1-era item sitting beside the one players actually
 * trade (`SkillGemUncutQuest1` vs `SkillGemUncut1`, `PinnacleKey1` vs
 * `BurningMonolithKey1`, `ExpeditionLogbook` vs `Expedition2Logbook`).
 *
 * First-one-wins picked the wrong twin in every case observed live, and the
 * losing id then has no short id, so ingest can't canonicalise it to a catalog
 * entry: the market keeps its raw Metadata path and lands in a phantom
 * one-item category named after its RePoE class.
 *
 * The tie-break that can't go stale is the exchange itself — whichever id GGG
 * actually lists a market for is the tradeable one. No hand-kept override list
 * to update when a league renames things.
 */

/**
 * @param {string[]} candidates Metadata ids sharing one display name.
 * @param {Set<string>} tradedIds Metadata ids seen in a live CX digest.
 * @returns {string|null} the id that should own the short id.
 */
export function chooseShortIdOwner(candidates, tradedIds = new Set()) {
  const ids = (candidates ?? []).filter((id) => typeof id === "string" && id);
  if (ids.length === 0) return null;
  if (ids.length === 1) return ids[0];

  const traded = ids.filter((id) => tradedIds.has(id));
  // Sorted, not first-seen: RePoE's key order is an input we don't control, and
  // an unstable owner would silently re-key markets between builds.
  if (traded.length > 0) return [...traded].sort()[0];

  // Nothing trades right now (an off-season item, or the digest was
  // unavailable). Any choice is a guess, so make it a repeatable one.
  return [...ids].sort()[0];
}

/** Collect every Metadata id that appears in a CX digest's market pairs. */
export function tradedIdsFromDigest(digest) {
  const ids = new Set();
  for (const market of digest?.markets ?? []) {
    for (const id of market?.market_pair ?? []) {
      if (typeof id === "string" && id) ids.add(id);
    }
  }
  return ids;
}
