/** Convert a market price between supported display currencies. */
export function convertMarketPrice(value, from, to, ratesOrDivineInExalted) {
  const rates = normalizeRates(ratesOrDivineInExalted);
  if (!positive(value) || !rates[from] || !rates[to]) return null;
  return (value * rates[from]) / rates[to];
}

/**
 * Express an anchor-denominated market price in one consistent quote currency.
 * Keep the quote direction stable: the returned value is always currency per
 * item, never an automatic reciprocal such as items per exalted.
 */
export function quoteFromAnchor(value, { anchor = "exalted", displayCurrency = null, rates } = {}) {
  if (!positive(value) || !positive(rates?.[anchor])) {
    return { value: null, unit: null };
  }

  const unit = displayCurrency && positive(rates[displayCurrency])
    ? displayCurrency
    : positive(rates.exalted)
      ? "exalted"
      : anchor;
  const quotedValue = (value * rates[anchor]) / rates[unit];
  return positive(quotedValue)
    ? { value: quotedValue, unit }
    : { value: null, unit: null };
}

/**
 * Manual observations override the delayed hourly midpoint. Otherwise the
 * latest official completed-hour reference is used, with source/age attached.
 */
export function workingPrice(
  row,
  savedManual,
  { rates: providedRates, divineInExalted, chaosInExalted, preferredUnit: wantedUnit, now = Date.now() } = {},
) {
  const anchor = row?.anchor;
  const rates = providedRates
    ? { ...providedRates, [anchor]: positive(providedRates[anchor]) ? providedRates[anchor] : 1 }
    : normalizeRates({ divineInExalted, chaosInExalted });
  const preferredUnit = rates[wantedUnit] ? wantedUnit : null;
  const manualUnit = rates[savedManual?.unit] ? savedManual.unit : null;
  const manualValue = Number(savedManual?.value);
  if (manualUnit && positive(manualValue)) {
    const anchorValue = convertMarketPrice(manualValue, manualUnit, anchor, rates);
    const displayUnit = preferredUnit ?? manualUnit;
    const displayValue = convertMarketPrice(anchorValue, anchor, displayUnit, rates);
    return {
      status: anchorValue == null ? "unconvertible-manual-price" : "ok",
      source: "manual",
      sourceLabel: "You entered",
      ageMs: Number.isFinite(savedManual?.updatedAt) ? Math.max(0, now - savedManual.updatedAt) : 0,
      value: displayValue ?? manualValue,
      unit: displayValue == null ? manualUnit : displayUnit,
      anchorValue,
    };
  }

  if (!positive(row?.reference) || !anchor) {
    return {
      status: "missing-hourly-price",
      source: "none",
      sourceLabel: "No current price",
      ageMs: null,
      value: null,
      unit: null,
      anchorValue: null,
    };
  }

  const unit = preferredUnit ?? row.displayPrice?.unit ?? anchor;
  const displayValue = convertMarketPrice(row.reference, anchor, unit, rates);
  return {
    status: displayValue == null ? "unconvertible-hourly-price" : "ok",
    source: "hourly",
    sourceLabel: "Hourly midpoint",
    ageMs: Number.isFinite(row.latestCompletedHour) ? Math.max(0, now - row.latestCompletedHour) : null,
    value: displayValue,
    unit,
    anchorValue: row.reference,
  };
}

function normalizeRates(ratesOrDivineInExalted) {
  if (typeof ratesOrDivineInExalted === "number") {
    return {
      exalted: 1,
      divine: positive(ratesOrDivineInExalted) ? ratesOrDivineInExalted : null,
      chaos: null,
    };
  }
  if (
    ratesOrDivineInExalted
    && ["exalted", "chaos", "divine"].some((unit) => Object.hasOwn(ratesOrDivineInExalted, unit))
  ) {
    return {
      exalted: positive(ratesOrDivineInExalted.exalted) ? ratesOrDivineInExalted.exalted : null,
      chaos: positive(ratesOrDivineInExalted.chaos) ? ratesOrDivineInExalted.chaos : null,
      divine: positive(ratesOrDivineInExalted.divine) ? ratesOrDivineInExalted.divine : null,
    };
  }
  return {
    exalted: 1,
    divine: positive(ratesOrDivineInExalted?.divineInExalted) ? ratesOrDivineInExalted.divineInExalted : null,
    chaos: positive(ratesOrDivineInExalted?.chaosInExalted) ? ratesOrDivineInExalted.chaosInExalted : null,
  };
}

// How deep into a window's hours the buy and sell targets sit. A quarter of the
// hours dipped at least to the buy, a quarter reached at least the sell — so
// both are prices the market visited repeatedly rather than once.
const ENTRY_QUANTILE = 0.25;
const EXIT_QUANTILE = 0.75;

/**
 * Rebase recent hourly low/high envelopes onto a user-observed current price.
 * History contributes only relative moves, not a fake real-time prediction.
 */
export function currentPriceGuidance(points, currentPrice, { maxSamples = 25, minSamples = 3, horizonHours = 1 } = {}) {
  if (!positive(currentPrice)) return { status: "invalid-current-price" };
  const candles = (points ?? [])
    .filter((point) => positive(point?.reference) && positive(point?.low) && positive(point?.high))
    .sort((a, b) => pointTime(a) - pointTime(b));
  const ratios = candles
    .slice(-maxSamples)
    .map((point) => ({ entry: point.low / point.reference, exit: point.high / point.reference }))
    .filter((point) => point.entry > 0 && point.entry <= 1 && point.exit >= 1);
  if (ratios.length < minSamples) return { status: "insufficient-history", samples: ratios.length };

  const horizon = horizonWindows(candles, { maxSamples, minSamples, horizonHours });
  // The horizon is already inside these numbers: futureLowFactor is the lowest
  // low over the NEXT horizonHours, futureHighFactor the highest high. Widening
  // them again by a sqrt(hours) multiplier counted the horizon twice, and on a
  // market with the occasional collapsing hour the buy target fell through the
  // 1%-of-price floor: Chaos Orb was quoting "buy at 0.485" against a market of
  // 48.5, with a 12,061% margin printed beside it.
  const adjustedEntryFactor = horizon.status === "ok"
    ? median(horizon.windows.map((point) => point.futureLowFactor))
    : median(ratios.map((point) => point.entry));
  const adjustedExitFactor = horizon.status === "ok"
    ? median(horizon.windows.map((point) => point.futureHighFactor))
    : median(ratios.map((point) => point.exit));
  if (!(adjustedEntryFactor > 0) || !(adjustedExitFactor > adjustedEntryFactor)) {
    return { status: "no-price-range", samples: ratios.length };
  }
  const entry = currentPrice * adjustedEntryFactor;
  const exit = currentPrice * adjustedExitFactor;
  const replay = horizon.status === "ok"
    ? replayPlan(horizon.windows, { entryFactor: adjustedEntryFactor, exitFactor: adjustedExitFactor })
    : null;
  return {
    status: "ok",
    samples: ratios.length,
    horizonHours,
    horizonSamples: horizon.status === "ok" ? horizon.windows.length : 0,
    currentPrice,
    entry,
    exit,
    entryDiscount: adjustedEntryFactor - 1,
    exitPremium: adjustedExitFactor - 1,
    rangePotential: entry > 0 ? exit / entry - 1 : null,
    entryFillRate: replay?.entryFillRate ?? null,
    exitAfterEntryRate: replay?.exitAfterEntryRate ?? null,
    medianHoursHeld: replay?.medianHoursHeld ?? null,
    medianAdverseMove: replay?.medianAdverseMove ?? null,
    replaySamples: replay?.samples ?? 0,
    filledSamples: replay?.filled ?? 0,
    observableSamples: replay?.observableSamples ?? 0,
  };
}

/**
 * Replay the displayed buy -> sell plan over past windows, in order.
 *
 * The previous version counted a window as evidence whenever some future high
 * reached the sell price. It never asked whether the buy would have filled, so a
 * window where the high came and went before the price ever fell to the entry
 * counted in favour of the plan. The wait was measured from the moment of the
 * decision rather than from the fill, for the same reason.
 *
 * Two deliberate conservative choices:
 *  - The sell must land in a LATER hour than the buy. GGG publishes an hour's
 *    low and high with no ordering between them, so a sell in the same hour
 *    cannot be shown to have followed the buy.
 *  - "Touched", never "filled": an hourly low reaching our price says the market
 *    traded there, not that our order cleared the queue at that size.
 */
export function replayPlan(windows, { entryFactor, exitFactor }) {
  const results = (windows ?? []).map((window) => replayWindow(window, entryFactor, exitFactor));
  const filled = results.filter((result) => result.filled);
  const observable = filled.filter((result) => result.canObserveExit);
  const held = filled.map((result) => result.hoursHeld).filter(Number.isFinite);
  const adverse = filled.map((result) => result.worstAfterEntry).filter(Number.isFinite);
  return {
    samples: results.length,
    filled: filled.length,
    entryFillRate: results.length ? filled.length / results.length : null,
    // Conditional on the buy having filled AND on an hour existing afterwards in
    // which a sell could have been seen. Null, not zero, when nothing can answer
    // it — the horizon is too short to contain a round trip.
    exitAfterEntryRate: observable.length
      ? observable.filter((result) => result.reachedExit).length / observable.length
      : null,
    observableSamples: observable.length,
    medianHoursHeld: held.length ? median(held) : null,
    medianAdverseMove: adverse.length ? median(adverse) : null,
  };
}

function replayWindow(window, entryFactor, exitFactor) {
  const base = window?.start?.reference;
  if (!positive(base)) return { filled: false };
  const entryPrice = base * entryFactor;
  const exitPrice = base * exitFactor;
  const future = window.future ?? [];

  const entryIndex = future.findIndex((point) => positive(point.low) && point.low <= entryPrice);
  if (entryIndex === -1) return { filled: false };
  const entryTime = pointTime(future[entryIndex]);
  // Whether a sell could even be observed. At a 1-hour horizon there is exactly
  // one future hour, so a filled buy has nothing after it and "then sold" was
  // structurally 0% — an artefact of the horizon, printed as if it were a fact
  // about the market.
  const canObserveExit = entryIndex < future.length - 1;

  let worstAfterEntry = 0;
  for (let i = entryIndex + 1; i < future.length; i++) {
    const point = future[i];
    // Test the sell BEFORE counting this hour's low. Same reason the sell may
    // not share the buy's hour: with no ordering inside an hour, a low in the
    // hour that sold could have happened after the sale, and a closed position
    // cannot draw down.
    if (positive(point.high) && point.high >= exitPrice) {
      const exitTime = pointTime(point);
      return {
        filled: true,
        canObserveExit,
        reachedExit: true,
        hoursHeld:
          Number.isFinite(exitTime) && Number.isFinite(entryTime) ? Math.max(0, (exitTime - entryTime) / 3600_000) : null,
        worstAfterEntry,
      };
    }
    if (positive(point.low)) worstAfterEntry = Math.min(worstAfterEntry, point.low / entryPrice - 1);
  }
  return { filled: true, canObserveExit, reachedExit: false, hoursHeld: null, worstAfterEntry };
}

function horizonWindows(points, { maxSamples, minSamples, horizonHours }) {
  const horizonMs = Math.max(1, Number(horizonHours) || 1) * 3600_000;
  const windows = [];
  // The newest hours cannot answer a question about the next N hours yet. Left
  // in, they were counted as windows where the plan simply did not work out —
  // at a 24h horizon almost every one of the 25 sampled windows was truncated,
  // so the score was mostly measuring how close each window sat to the end of
  // the data.
  const lastTime = pointTime(points.at(-1));
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const startTime = pointTime(start);
    if (!Number.isFinite(startTime) || !positive(start.reference)) continue;
    if (Number.isFinite(lastTime) && lastTime < startTime + horizonMs) continue;
    const future = points.slice(i + 1).filter((point) => {
      const t = pointTime(point);
      return Number.isFinite(t) && t > startTime && t <= startTime + horizonMs;
    });
    if (!future.length) continue;
    // A quarter of the hours reached at least this low, three quarters at least
    // this high — rather than the single most extreme print in either direction.
    const low = quantile(future.map((point) => point.low).filter(positive), ENTRY_QUANTILE);
    const high = quantile(future.map((point) => point.high).filter(positive), EXIT_QUANTILE);
    if (!positive(high) || !positive(low)) continue;
    windows.push({
      start,
      future,
      futureHighFactor: high / start.reference,
      futureLowFactor: low / start.reference,
    });
  }
  const recent = windows.slice(-maxSamples);
  return recent.length >= minSamples ? { status: "ok", windows: recent } : { status: "insufficient-history", windows: recent };
}

function pointTime(point) {
  if (Number.isFinite(point?.completedHour)) return point.completedHour;
  if (Number.isFinite(point?.t)) return point.t;
  return NaN;
}

/**
 * Linear-interpolated quantile.
 *
 * Used instead of the min/max of a window because those are single prints. In a
 * thin market one trade at a tenth of the going rate drags the buy target down
 * with it, and a median across windows does not save you when nearly every
 * window contains such a print — Chaos Orb quoted "buy at 0.485" against a
 * market of 48.5. A low quantile asks a question a trader can act on: a price
 * the market kept coming back to, not the worst thing that ever happened in it.
 */
function quantile(values, q) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function positive(value) {
  return Number.isFinite(value) && value > 0;
}
