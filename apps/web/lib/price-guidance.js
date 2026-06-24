/** Convert a market price between the two supported display currencies. */
export function convertMarketPrice(value, from, to, divineInExalted) {
  if (!positive(value) || !["exalted", "divine"].includes(from) || !["exalted", "divine"].includes(to)) return null;
  if (from === to) return value;
  if (!positive(divineInExalted)) return null;
  return from === "divine" ? value * divineInExalted : value / divineInExalted;
}

/**
 * Manual observations override the delayed hourly midpoint. Otherwise the
 * latest official completed-hour reference is used, with source/age attached.
 */
export function workingPrice(row, savedManual, { divineInExalted, now = Date.now() } = {}) {
  const anchor = row?.anchor;
  const manualUnit = ["exalted", "divine"].includes(savedManual?.unit) ? savedManual.unit : null;
  const manualValue = Number(savedManual?.value);
  if (manualUnit && positive(manualValue)) {
    const anchorValue = convertMarketPrice(manualValue, manualUnit, anchor, divineInExalted);
    return {
      status: anchorValue == null ? "unconvertible-manual-price" : "ok",
      source: "manual",
      sourceLabel: "You entered",
      ageMs: Number.isFinite(savedManual?.updatedAt) ? Math.max(0, now - savedManual.updatedAt) : 0,
      value: manualValue,
      unit: manualUnit,
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

  const unit = row.displayPrice?.unit ?? anchor;
  const displayValue = convertMarketPrice(row.reference, anchor, unit, divineInExalted);
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

  const entryFactor = median(ratios.map((point) => point.entry));
  const horizon = horizonWindows(candles, { maxSamples, minSamples, horizonHours });
  const exitFactor = horizon.status === "ok"
    ? median(horizon.windows.map((point) => point.futureHighFactor))
    : median(ratios.map((point) => point.exit));
  const entry = currentPrice * entryFactor;
  const exit = currentPrice * exitFactor;
  const hitRate = horizon.status === "ok"
    ? horizon.windows.filter((point) => point.futureHighFactor >= exitFactor).length / horizon.windows.length
    : null;
  const hitTimes = horizon.status === "ok"
    ? horizon.windows.map((point) => timeToHit(point, exitFactor)).filter(Number.isFinite)
    : [];
  const adverseMoves = horizon.status === "ok"
    ? horizon.windows.map((point) => point.futureLowFactor - 1).filter(Number.isFinite)
    : [];
  return {
    status: "ok",
    samples: ratios.length,
    horizonHours,
    horizonSamples: horizon.status === "ok" ? horizon.windows.length : 0,
    currentPrice,
    entry,
    exit,
    entryDiscount: entryFactor - 1,
    exitPremium: exitFactor - 1,
    rangePotential: entry > 0 ? exit / entry - 1 : null,
    hitRate,
    medianTimeToHitHours: hitTimes.length ? median(hitTimes) : null,
    medianAdverseMove: adverseMoves.length ? median(adverseMoves) : null,
  };
}

function horizonWindows(points, { maxSamples, minSamples, horizonHours }) {
  const horizonMs = Math.max(1, Number(horizonHours) || 1) * 3600_000;
  const windows = [];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const startTime = pointTime(start);
    if (!Number.isFinite(startTime) || !positive(start.reference)) continue;
    const future = points.slice(i + 1).filter((point) => {
      const t = pointTime(point);
      return Number.isFinite(t) && t > startTime && t <= startTime + horizonMs;
    });
    if (!future.length) continue;
    const high = Math.max(...future.map((point) => point.high).filter(Number.isFinite));
    const low = Math.min(...future.map((point) => point.low).filter(Number.isFinite));
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

function timeToHit(window, factor) {
  if (!positive(window?.start?.reference)) return null;
  const startTime = pointTime(window.start);
  for (const point of window.future) {
    if (positive(point.high) && point.high / window.start.reference >= factor) {
      const t = pointTime(point);
      return Number.isFinite(t) && Number.isFinite(startTime) ? Math.max(0, (t - startTime) / 3600_000) : null;
    }
  }
  return null;
}

function pointTime(point) {
  if (Number.isFinite(point?.completedHour)) return point.completedHour;
  if (Number.isFinite(point?.t)) return point.t;
  return NaN;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function positive(value) {
  return Number.isFinite(value) && value > 0;
}
