import { unitRates } from "./market-units.js";

const CORE = [
  { id: "chaos", name: "Chaos Orb" },
  { id: "divine", name: "Divine Orb" },
  { id: "exalted", name: "Exalted Orb" },
];

const positive = (value) => Number.isFinite(value) && value > 0;

/**
 * How much of a day the card's series must actually cover before the change
 * across it may be shown under the panel's "Last 24 completed hours" heading.
 * Mirrors MIN_SPAN_RATIO in src/domain/market-radar.js — the cards cannot reuse
 * a row's own movement.h24 because their series is CONVERTED through the core
 * currency graph, so the same rule has to be applied again here. Without it a
 * league nine hours old published a nine-hour swing as a daily one.
 */
const MIN_SPAN_MS = 0.75 * 24 * 3600_000;

function movement(values) {
  if (values.length < 2 || !positive(values[0])) return null;
  return values[values.length - 1] / values[0] - 1;
}

/**
 * How far back the shortest core series reaches. The converted timeline is only
 * as long as its shortest input, so the minimum is what the cards may claim.
 * Null when no row carries the span (an older payload, or no data at all).
 */
function timelineSpanMs(coreRows) {
  const spans = coreRows
    .filter((row) => Number.isFinite(row?.latestCompletedHour) && Number.isFinite(row?.sparklineFromHour))
    .map((row) => row.latestCompletedHour - row.sparklineFromHour);
  return spans.length ? Math.min(...spans) : null;
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

function normalizedCard(currency, unit, rates, timeline, spansDay) {
  const value = rateBetween(rates, currency.id, unit);
  const values = timeline.map((snapshot) => rateBetween(snapshot, currency.id, unit)).filter(positive);
  return {
    ...currency,
    value,
    unit,
    values,
    // The sparkline still draws whatever history exists; only the labelled
    // percentage waits for a real day. formatPercent renders null as "—".
    movement: spansDay ? movement(values) : null,
    spansDay,
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
export function keyCurrencyCards(rows = [], fallbackAnchor = "exalted", preferredUnit = null) {
  const anchor = fallbackAnchor;
  const rates = unitRates(rows, anchor);
  const timeline = rateTimeline(rows, anchor);
  const span = timelineSpanMs(rows.filter((row) => CORE.some((currency) => currency.id === row?.target)));
  const spansDay = span != null && span >= MIN_SPAN_MS;
  // What the panel may honestly call its window. Capped at a day because the
  // sparkline is 25 points: in a sparse market those can reach back further,
  // but the core currencies trade hourly, so the cap is the truthful label.
  const spanHours = span == null ? null : Math.min(24, Math.round(span / 3600_000));
  const inverseOrder = anchor === "chaos" ? ["exalted", "divine"] : ["chaos", "divine"];
  const inverseUnit = inverseOrder.find((id) => positive(rates[id])) ?? inverseOrder[0];
  const selectedUnit = positive(rates[preferredUnit]) ? preferredUnit : null;
  return CORE.map((currency) => {
    // Honour the dashboard display selector for every meaningful quote. The
    // selected currency's own card stays reciprocal instead of rendering the
    // useless identity rate "1 Chaos per Chaos".
    const unit = selectedUnit && currency.id !== selectedUnit
      ? selectedUnit
      : currency.id === anchor
        ? inverseUnit
        : anchor;
    return { ...normalizedCard(currency, unit, rates, timeline, spansDay), spanHours };
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
