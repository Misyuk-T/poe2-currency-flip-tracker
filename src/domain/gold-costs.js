/**
 * Gold-cost domain logic.
 *
 * A registry is scoped to a single game. PoE1 and PoE2 tables must never be
 * merged: pass exactly one game's records to {@link createGoldRegistry}.
 */

/**
 * @param {import("../data/gold-costs-poe2.js").GoldCostRecord[]} records
 * @param {{ game?: string }} [opts]
 */
export function createGoldRegistry(records, opts = {}) {
  const game = opts.game ?? records[0]?.game ?? null;
  const byId = new Map();
  for (const r of records) {
    if (game && r.game !== game) {
      throw new Error(
        `Refusing to mix gold tables: record "${r.itemId}" is ${r.game}, registry is ${game}.`,
      );
    }
    // Keep the most recent effectiveFrom for a given item id.
    const existing = byId.get(r.itemId);
    if (!existing || r.effectiveFrom > existing.effectiveFrom) byId.set(r.itemId, r);
  }
  return {
    game,
    /** @returns {number|undefined} gold per received unit, or undefined if unknown. */
    goldPerUnit(itemId) {
      return byId.get(itemId)?.goldPerUnit;
    },
    has(itemId) {
      return byId.has(itemId);
    },
    record(itemId) {
      return byId.get(itemId);
    },
    /** All known item ids in this registry. */
    ids() {
      return [...byId.keys()];
    },
    /**
     * Split a list of ids into covered (known gold cost) and missing.
     * @param {string[]} ids
     * @returns {{ covered: string[], missing: string[] }}
     */
    coverage(ids) {
      const covered = [];
      const missing = [];
      for (const id of ids) (byId.has(id) ? covered : missing).push(id);
      return { covered, missing };
    },
  };
}

/**
 * Validate that every actionable id (anchor + shortlist targets) has a known,
 * versioned gold cost. Targets without a cost are NOT guessed: they are reported
 * as gaps so the caller can surface them and mark them unrankable.
 *
 * @param {ReturnType<typeof createGoldRegistry>} registry
 * @param {{ anchorCurrency: string, shortlist: string[] }} cfg
 * @returns {{ anchorCovered: boolean, covered: string[], missing: string[] }}
 */
export function validateShortlistCoverage(registry, { anchorCurrency, shortlist }) {
  const { covered, missing } = registry.coverage(shortlist);
  return {
    anchorCovered: registry.has(anchorCurrency),
    covered,
    missing,
  };
}

/**
 * Gold spent to *receive* `receivedQuantity` units of an item.
 * Gold is always an integer and conservatively rounded UP.
 *
 * @returns {number|null} integer gold, or null when the cost is unknown.
 */
export function goldForLeg(receivedQuantity, goldPerUnit) {
  if (!Number.isFinite(receivedQuantity) || receivedQuantity < 0) {
    throw new Error(`receivedQuantity must be a non-negative finite number, got ${receivedQuantity}`);
  }
  if (goldPerUnit == null || !Number.isFinite(goldPerUnit)) return null;
  return Math.ceil(receivedQuantity * goldPerUnit);
}

/**
 * Total gold for a round trip A -> B -> A.
 *
 *   total = ceil(receivedB * goldCost[B]) + ceil(receivedA * goldCost[A])
 *
 * @returns {{ entryGold: number|null, exitGold: number|null, totalGold: number|null }}
 */
export function roundTripGold({ receivedTarget, receivedAnchorOnExit, goldPerTarget, goldPerAnchor }) {
  const entryGold = goldForLeg(receivedTarget, goldPerTarget);
  const exitGold = goldForLeg(receivedAnchorOnExit, goldPerAnchor);
  const totalGold = entryGold == null || exitGold == null ? null : entryGold + exitGold;
  return { entryGold, exitGold, totalGold };
}
