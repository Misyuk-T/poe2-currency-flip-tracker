import { unitRates } from "./market-units.js";

const CORE = [
  { id: "chaos", name: "Chaos Orb" },
  { id: "divine", name: "Divine Orb" },
  { id: "exalted", name: "Exalted Orb" },
];

const positive = (value) => Number.isFinite(value) && value > 0;

function movement(values) {
  if (values.length < 2 || !positive(values[0])) return null;
  return values[values.length - 1] / values[0] - 1;
}

function rateBetween(rates, currency, unit) {
  if (!positive(rates?.[currency]) || !positive(rates?.[unit])) return null;
  return rates[currency] / rates[unit];
}

/** Build the same core-currency conversion graph for every sparkline hour. */
function rateTimeline(rows, fallbackAnchor) {
  const coreRows = rows.filter((row) => CORE.some((currency) => currency.id === row?.target));
  const length = Math.max(0, ...coreRows.map((row) => row.sparkline24h?.length ?? 0));
  return Array.from({ length }, (_, index) => {
    const distanceFromEnd = length - index;
    const snapshotRows = coreRows.map((row) => {
      const values = row.sparkline24h ?? [];
      return { ...row, reference: values[values.length - distanceFromEnd] };
    });
    return unitRates(snapshotRows, fallbackAnchor);
  });
}

function normalizedCard(currency, unit, rates, timeline) {
  const value = rateBetween(rates, currency.id, unit);
  const values = timeline.map((snapshot) => rateBetween(snapshot, currency.id, unit)).filter(positive);
  return {
    ...currency,
    value,
    unit,
    values,
    movement: movement(values),
    available: positive(value),
  };
}

/**
 * Three dashboard cards from the already-loaded radar payload. Every card is
 * converted through one core-currency graph, because the merged radar may keep
 * Chaos priced in Divine while Divine is priced in Exalted. Inverting the raw
 * Chaos row in that case yields "Chaos per Divine" and must never be labelled
 * "Chaos per Exalted".
 */
export function keyCurrencyCards(rows = [], fallbackAnchor = "exalted") {
  const anchor = fallbackAnchor;
  const rates = unitRates(rows, anchor);
  const timeline = rateTimeline(rows, anchor);
  const inverseOrder = anchor === "chaos" ? ["exalted", "divine"] : ["chaos", "divine"];
  const inverseUnit = inverseOrder.find((id) => positive(rates[id])) ?? inverseOrder[0];
  return CORE.map((currency) => {
    const unit = currency.id === anchor ? inverseUnit : anchor;
    return normalizedCard(currency, unit, rates, timeline);
  });
}

/** Scale finite values into an SVG polyline without leaking chart concerns. */
export function sparklinePoints(values, width = 180, height = 54, padding = 3) {
  const clean = (values ?? []).filter(positive);
  if (clean.length < 2) return "";
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const span = max - min || Math.max(Math.abs(max) * 0.01, 1e-9);
  return clean
    .map((value, index) => {
      const x = padding + (index / (clean.length - 1)) * (width - padding * 2);
      const y = height - padding - ((value - min) / span) * (height - padding * 2);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}
