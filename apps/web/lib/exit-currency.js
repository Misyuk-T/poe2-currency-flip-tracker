import { goldForLeg } from "../../../src/domain/gold-costs.js";

/**
 * Pick the cheapest anchor currency to take payment in when selling something.
 *
 * The *value* is identical whichever anchor you accept — a ratio is a ratio.
 * What genuinely differs is the GOLD you are charged, because gold scales with
 * the quantity RECEIVED (`ceil(qty * goldPerUnit)`, see src/domain/gold-costs.js).
 * Taking payment in a high-unit-value currency means receiving few units, so it
 * costs far less gold than being paid the same worth in a cheap currency.
 *
 * The second real constraint is granularity: you cannot receive a fraction of
 * an orb. An item worth less than one divine simply cannot be sold for divine,
 * so cheap items land on chaos/exalted and expensive ones on divine — which is
 * why the best exit legitimately differs per item rather than being one global
 * answer.
 *
 * Everything here is arithmetic over the caller's live rates + the project's
 * existing gold model. Nothing is estimated or invented: when a rate or a gold
 * cost is missing, that candidate is simply dropped.
 *
 * @param {number} exaltedValue Worth of the holding, denominated in exalted.
 * @param {{ rates: Record<string, number>, goldPerUnit: Record<string, number> }} ctx
 *   `rates` is exalted-per-unit for each candidate; `goldPerUnit` is the gold
 *   charged per unit received of each candidate.
 * @returns {{ best: object|null, candidates: object[] }}
 */
export function bestExitCurrency(exaltedValue, { rates, goldPerUnit } = {}) {
  if (!Number.isFinite(exaltedValue) || exaltedValue <= 0) return { best: null, candidates: [] };

  const candidates = Object.keys(rates ?? {})
    .map((unit) => {
      const rate = rates[unit];
      const perUnit = goldPerUnit?.[unit];
      if (!Number.isFinite(rate) || rate <= 0) return null;
      const units = exaltedValue / rate;
      const gold = goldForLeg(units, Number.isFinite(perUnit) ? perUnit : null);
      return {
        unit,
        units,
        gold,
        // You cannot be paid a fraction of an orb, so anything under one whole
        // unit is not a real exit for this holding.
        fillable: units >= 1,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.unit.localeCompare(b.unit));

  const usable = candidates.filter((entry) => entry.fillable && Number.isFinite(entry.gold));
  const best = usable.length
    ? usable.reduce((cheapest, entry) => (entry.gold < cheapest.gold ? entry : cheapest))
    : null;

  return { best, candidates };
}
