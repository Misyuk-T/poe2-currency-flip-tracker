/**
 * How the table talks about its gold numbers.
 *
 * The radar payload carries `gold` (see describeGoldProvenance in
 * src/domain/gold-costs.js) saying which of three sources produced the
 * per-currency costs. The rule here is that the word "placeholder" is reserved
 * for the one case that IS a placeholder — the flat, uniform demo stand-in. A
 * sourced number gets stated as what it is, with the date it was observed.
 *
 * When a payload carries no `gold` at all (a snapshot stored before this key
 * existed, or PoE1, which has no gold table), the text states the number and
 * claims nothing about where it came from. That is the only safe default: it
 * cannot over-claim a demo number, and it cannot dismiss a real one.
 */

import { formatNumber } from "./market.js";

const SPREAD_NOTE =
  "Distance from the hour's lowest reported price to its highest. GGG does not publish which came first, so this is the size of the opportunity, not a completed round trip.";

/**
 * The clause that follows the gold figure — what the number is and how old it
 * is. Empty string when the payload says nothing about provenance.
 *
 * @param {{ source?: string, effectiveFrom?: string|null }|null|undefined} gold
 */
export function goldSourceNote(gold) {
  if (gold?.source === "placeholder") {
    return " (flat placeholder, not per-currency data)";
  }
  if (gold?.source !== "committed" && gold?.source !== "database") return "";
  const observed = typeof gold.effectiveFrom === "string" && gold.effectiveFrom
    ? `, observed ${gold.effectiveFrom}`
    : "";
  return ` — the in-game exchange fee to receive one unit${observed}`;
}

/**
 * Hover text for the Profit cell — moves the gold-efficiency detail out of a
 * dedicated column and into a tooltip: exalted profit per 100k gold of trade
 * tax, plus the raw gold cost of one round-trip flip. Falls back gracefully
 * when gold data is missing.
 *
 * @param {{ _profitPer100k?: number|null, _goldPerFlip?: number|null }} row
 * @param {{ source?: string, effectiveFrom?: string|null }|null} [gold]
 */
export function goldTooltip(row, gold = null) {
  const parts = [SPREAD_NOTE];
  if (Number.isFinite(row?._profitPer100k)) {
    parts.push(`≈ ${formatNumber(row._profitPer100k, { maximumFractionDigits: 1 })} exalted profit per 100,000 gold of trade tax.`);
  }
  if (Number.isFinite(row?._goldPerFlip)) {
    const cost = formatNumber(row._goldPerFlip, { maximumFractionDigits: 0 });
    parts.push(`Gold cost per 1-unit flip ≈ ${cost}${goldSourceNote(gold)}.`);
  }
  return parts.join(" ");
}
