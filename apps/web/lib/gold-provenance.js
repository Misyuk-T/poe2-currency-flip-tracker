/**
 * How the table talks about its gold numbers.
 *
 * Two separate honesty problems, both of which the old single word
 * "(placeholder)" got wrong:
 *
 * 1. WHAT the figure is. `_goldPerFlip` is roundTripGold's TWO-leg total —
 *    gold charged on the target unit received when buying in, PLUS gold charged
 *    on the anchor received when selling back out. It is several times the
 *    per-unit fee of either leg, so it must never be described as the fee to
 *    receive one unit.
 * 2. WHERE the numbers came from. The radar payload carries `gold` (see
 *    describeGoldProvenance in src/domain/gold-costs.js) saying which of three
 *    sources produced them. The word "placeholder" is reserved for the one case
 *    that IS a placeholder — the flat, uniform demo stand-in. A sourced number
 *    gets stated as what it is, with the date it was observed.
 *
 * The date is per ROW where the payload has one (`row.gold.effectiveFrom` and
 * `row.anchorGoldEffectiveFrom`, the two legs), because a partial `gold_costs`
 * refresh can leave values of different ages side by side. Where the two legs
 * disagree we show the OLDER one: the figure is a sum of both, so it is only as
 * fresh as its stalest input.
 *
 * When a payload carries no provenance at all (a snapshot stored before these
 * keys existed, or PoE1, which has no gold table), the text still says what the
 * figure IS and claims nothing about where it came from. That is the only safe
 * default: it cannot over-claim a demo number, and it cannot dismiss a real one.
 */

import { formatNumber } from "./market.js";

const SPREAD_NOTE =
  "Distance from the hour's lowest reported price to its highest. GGG does not publish which came first, so this is the size of the opportunity, not a completed round trip.";

/** The older of two ISO dates, ignoring missing ones. */
export function olderDate(a, b) {
  const dates = [a, b].filter((value) => typeof value === "string" && value);
  if (!dates.length) return null;
  return dates.reduce((oldest, value) => (value < oldest ? value : oldest));
}

/**
 * The clause that follows "both legs of the round trip" — where the two gold
 * costs came from and how old they are. Empty when the payload says nothing.
 *
 * @param {{ source?: string, effectiveFrom?: string|null }|null|undefined} gold
 * @param {string|null} [observedFrom] this row's own observation date, if the
 *   payload carries one; otherwise the payload-wide floor is used.
 */
export function goldSourceNote(gold, observedFrom = null) {
  if (gold?.source === "placeholder") {
    return ", from a flat placeholder, not per-currency data";
  }
  if (gold?.source !== "committed" && gold?.source !== "database") return "";
  const observed = observedFrom ?? gold.effectiveFrom;
  if (typeof observed !== "string" || !observed) return "";
  return `; gold costs observed ${observed}`;
}

/**
 * Hover text for the Profit cell — moves the gold-efficiency detail out of a
 * dedicated column and into a tooltip: exalted profit per 100k gold of trade
 * tax, plus the gold cost of one round-trip flip. Falls back gracefully when
 * gold data is missing.
 *
 * @param {{ _profitPer100k?: number|null, _goldPerFlip?: number|null, _goldObservedFrom?: string|null }} row
 * @param {{ source?: string, effectiveFrom?: string|null }|null} [gold]
 */
export function goldTooltip(row, gold = null) {
  const parts = [SPREAD_NOTE];
  if (Number.isFinite(row?._profitPer100k)) {
    parts.push(`≈ ${formatNumber(row._profitPer100k, { maximumFractionDigits: 1 })} exalted profit per 100,000 gold of trade tax.`);
  }
  if (Number.isFinite(row?._goldPerFlip)) {
    const cost = formatNumber(row._goldPerFlip, { maximumFractionDigits: 0 });
    const note = goldSourceNote(gold, row?._goldObservedFrom ?? null);
    parts.push(`Gold cost per 1-unit flip ≈ ${cost} — both legs of the round trip${note}.`);
  }
  return parts.join(" ");
}
