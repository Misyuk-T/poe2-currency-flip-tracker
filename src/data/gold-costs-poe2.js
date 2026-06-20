/**
 * Versioned PoE2 gold-cost registry.
 *
 * Gold is a second scarce, account-bound resource. Every currency-exchange leg
 * costs gold proportional to the quantity *received*:
 *
 *     gold_for_leg = ceil(received_quantity * goldPerUnit)
 *
 * These values are a data-derived snapshot, NOT an eternal universal formula.
 * They must stay verifiable/configurable and must NEVER be silently shared with
 * PoE1 (which uses a different table). See the brief and:
 *   - https://poe2db.tw/us/Currency_Exchange
 *   - https://www.poe2wiki.net/wiki/Currency_exchange
 *
 * Maintenance: add a row to {@link GOLD_TABLE}. Each row is
 * `[itemId, displayName, goldPerUnit]`; shared provenance (game / patch /
 * effectiveFrom / source) is applied by {@link buildRecords}. To supersede a
 * value in a later patch, append a new block with a newer `effectiveFrom` — the
 * registry keeps the most recent record per id (see createGoldRegistry).
 *
 * Honesty rule: do NOT invent a gold cost for a currency you cannot source. A
 * missing entry is surfaced as a coverage gap and the target is marked
 * unrankable; it is never guessed.
 *
 * @typedef {Object} GoldCostRecord
 * @property {"poe2"} game
 * @property {string} patchOrVersion
 * @property {string} itemId       Stable exchange item id (matches GGG `have`/`want` ids).
 * @property {string} displayName
 * @property {number} goldPerUnit  Gold cost per received unit (integer).
 * @property {string} effectiveFrom ISO date this value was observed/applies from.
 * @property {string} source
 */

const PROVENANCE = {
  game: /** @type {"poe2"} */ ("poe2"),
  patchOrVersion: "0.3-observed-2026-06-19",
  effectiveFrom: "2026-06-19",
  source: "brief data table (poe2db / poe2wiki derived)",
};

/** @type {[string, string, number][]} `[itemId, displayName, goldPerUnit]` */
const GOLD_TABLE = [
  ["exalted", "Exalted Orb", 120],
  ["chaos", "Chaos Orb", 160],
  ["divine", "Divine Orb", 800],
  // ids reconciled against GGG trade2 data/static (see src/data/catalog-poe2.json):
  ["greater-exalted-orb", "Greater Exalted Orb", 360],
  ["chance", "Orb of Chance", 1000],
  ["annul", "Orb of Annulment", 1000],
  ["artificers", "Artificer's Orb", 1000],
  ["fracturing-orb", "Fracturing Orb", 1000],
  ["mirror", "Mirror of Kalandra", 25000],
];

function buildRecords(table, provenance) {
  return table.map(([itemId, displayName, goldPerUnit]) => ({
    ...provenance,
    itemId,
    displayName,
    goldPerUnit,
  }));
}

/** @type {GoldCostRecord[]} */
export const POE2_GOLD_COSTS = buildRecords(GOLD_TABLE, PROVENANCE);
