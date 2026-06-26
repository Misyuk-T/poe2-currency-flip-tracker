/**
 * Paper-trade engine — the honesty backbone of C3.
 *
 * Given a recommendation made at a completed hour (a limit-buy flip: buy `size`
 * of the target at `entryPrice`, take profit at `targetExit`, both in anchor
 * units), simulate the realised outcome over the next `horizonHours` using the
 * actual hourly candles that followed. Everything here is pure and
 * deterministic — no clock except the injected `now`, no storage, no network —
 * so a backtest is fully reproducible and testable.
 *
 * It never fabricates an outcome: when the horizon has not elapsed (or no
 * candles exist yet) the trade is reported as `pending`/`open`/`no-data`, not as
 * a win or a loss. This is what lets the product talk about realised paper-trade
 * results honestly instead of claiming "the model finds profitable flips".
 */

import { roundTripGold } from "./gold-costs.js";

const HOUR = 3600_000;

const positive = (v) => Number.isFinite(v) && v > 0;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const validCandle = (c) =>
  c && Number.isFinite(c.completedHour) && positive(c.low) && positive(c.high) && positive(c.reference);

function median(values) {
  const xs = [...values].sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

function avg(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/**
 * @param {{
 *   target?: string, anchor?: string,
 *   entryHour: number, entryPrice: number, targetExit: number,
 *   horizonHours?: number, size?: number,
 *   goldPerTarget?: number|null, goldPerAnchor?: number|null,
 * }} trade
 * @param {Array<{completedHour:number, low:number, high:number, reference:number}>} series
 *   candles in ANCHOR units (see candleForAnchor), any order.
 * @param {{ now?: number }} [opts]
 */
export function evaluatePaperTrade(trade, series, { now = Date.now() } = {}) {
  const size = positive(trade?.size) ? trade.size : 1;
  if (!positive(trade?.entryPrice) || !positive(trade?.targetExit) || !Number.isFinite(trade?.entryHour)) {
    return { status: "invalid", reason: "missing-entry-exit-or-hour", filled: false, profit: null };
  }
  if (trade.targetExit <= trade.entryPrice) {
    return { status: "invalid", reason: "exit-not-above-entry", filled: false, profit: null };
  }

  const horizonHours = Math.max(1, Number(trade.horizonHours) || 1);
  const horizonEnd = trade.entryHour + horizonHours * HOUR;
  const horizonElapsed = now >= horizonEnd;

  const base = {
    status: "pending",
    filled: false,
    size,
    horizonHours,
    target: trade.target ?? null,
    anchor: trade.anchor ?? null,
    entryHour: trade.entryHour,
    entryPrice: trade.entryPrice,
    targetExit: trade.targetExit,
    profit: null,
    profitPct: null,
  };

  const forward = (series ?? [])
    .filter((c) => validCandle(c) && c.completedHour > trade.entryHour && c.completedHour <= horizonEnd)
    .sort((a, b) => a.completedHour - b.completedHour);

  if (!forward.length) {
    // Nothing to evaluate against yet. Only call it "no-data" once the window
    // has elapsed; before that the trade is simply still resolving.
    return { ...base, status: horizonElapsed ? "no-data" : "pending" };
  }

  // Entry: a limit buy fills the first hour whose low reaches the entry price.
  const fillIndex = forward.findIndex((c) => c.low <= trade.entryPrice);
  if (fillIndex === -1) {
    return horizonElapsed
      ? { ...base, status: "entry-missed", profit: 0, profitPct: 0 }
      : { ...base, status: "pending" };
  }
  const fillHour = forward[fillIndex].completedHour;
  const afterFill = forward.slice(fillIndex);

  // Exit: a take-profit fills the first hour whose high reaches the target.
  const exitIndex = afterFill.findIndex((c) => c.high >= trade.targetExit);

  let status;
  let exitPrice;
  let exitHour;
  let marked;
  if (exitIndex !== -1) {
    status = "closed";
    exitPrice = trade.targetExit;
    exitHour = afterFill[exitIndex].completedHour;
    marked = false;
  } else if (horizonElapsed) {
    // Filled but the target never printed inside the window → mark to market at
    // the last completed hour's midpoint. This is where losses surface.
    status = "open-at-horizon";
    const last = afterFill[afterFill.length - 1];
    exitPrice = last.reference;
    exitHour = last.completedHour;
    marked = true;
  } else {
    // Filled, target not yet hit, horizon not elapsed → still holding.
    const minLowSoFar = Math.min(...afterFill.map((c) => c.low));
    return {
      ...base,
      status: "open",
      filled: true,
      fillHour,
      maeFactor: minLowSoFar / trade.entryPrice - 1,
    };
  }

  // Max adverse excursion: the worst low while the position was held.
  const heldThrough = exitIndex !== -1 ? afterFill.slice(0, exitIndex + 1) : afterFill;
  const maeFactor = Math.min(...heldThrough.map((c) => c.low)) / trade.entryPrice - 1;

  const profit = size * (exitPrice - trade.entryPrice); // anchor units
  const profitPct = exitPrice / trade.entryPrice - 1;
  const gold = goldEfficiency(trade, { size, exitPrice, profit });

  return {
    ...base,
    status,
    filled: true,
    marked,
    fillHour,
    exitHour,
    holdingHours: (exitHour - fillHour) / HOUR,
    exitPrice,
    maeFactor,
    profit,
    profitPct,
    ...gold,
  };
}

/** Round-trip gold for the flip and profit per 100k gold, when costs are known. */
function goldEfficiency(trade, { size, exitPrice, profit }) {
  const goldPerTarget = num(trade.goldPerTarget);
  const goldPerAnchor = num(trade.goldPerAnchor);
  if (goldPerTarget == null && goldPerAnchor == null) return { totalGold: null, profitPer100kGold: null };
  const { totalGold } = roundTripGold({
    receivedTarget: size,
    receivedAnchorOnExit: size * exitPrice,
    goldPerTarget,
    goldPerAnchor,
  });
  return {
    totalGold,
    profitPer100kGold: positive(totalGold) ? (profit / totalGold) * 100_000 : null,
  };
}

/**
 * Aggregate evaluated trades into an honest paper-trade record. Only trades the
 * horizon has resolved (`closed` / `open-at-horizon` / `entry-missed`) count
 * toward the summary; `pending`/`open`/`no-data`/`invalid` are excluded but
 * surfaced as `pending` so a thin sample is never dressed up as a full record.
 */
export function summarizePaperTrades(results) {
  const all = (results ?? []).filter(Boolean);
  const resolvedStatuses = new Set(["closed", "open-at-horizon", "entry-missed"]);
  const resolved = all.filter((r) => resolvedStatuses.has(r.status));
  const taken = resolved.filter((r) => r.filled);
  const profits = taken.map((r) => r.profit).filter(Number.isFinite);
  const wins = profits.filter((p) => p > 0);
  const goldEff = taken.map((r) => r.profitPer100kGold).filter(Number.isFinite);

  return {
    evaluated: resolved.length,
    pending: all.length - resolved.length,
    taken: taken.length,
    closed: taken.filter((r) => r.status === "closed").length,
    openAtHorizon: taken.filter((r) => r.status === "open-at-horizon").length,
    entryMissed: resolved.filter((r) => r.status === "entry-missed").length,
    fillRate: resolved.length ? taken.length / resolved.length : null,
    winRate: taken.length ? wins.length / taken.length : null,
    avgProfit: avg(profits),
    medianProfit: median(profits),
    avgProfitPct: avg(taken.map((r) => r.profitPct).filter(Number.isFinite)),
    avgMaeFactor: avg(taken.map((r) => r.maeFactor).filter(Number.isFinite)),
    medianProfitPer100kGold: median(goldEff),
  };
}

/**
 * A default recommender for the backtest: median low/high envelope factors over
 * a trailing window, rebased on the hour's reference. Mirrors the product's
 * price guidance without depending on it (keeps this module dependency-light).
 * Returns `null` when there is not enough trailing history.
 */
export function medianFactorRecommender({ lookback = 24, minSamples = 3 } = {}) {
  return (history, point) => {
    if (!positive(point?.reference)) return null;
    const ratios = (history ?? [])
      .slice(-lookback)
      .filter(validCandle)
      .map((c) => ({ entry: c.low / c.reference, exit: c.high / c.reference }))
      .filter((r) => r.entry > 0 && r.entry <= 1 && r.exit >= 1);
    if (ratios.length < minSamples) return null;
    const entryFactor = median(ratios.map((r) => r.entry));
    const exitFactor = median(ratios.map((r) => r.exit));
    if (!(entryFactor > 0) || !(exitFactor > entryFactor)) return null;
    return { entryPrice: point.reference * entryFactor, targetExit: point.reference * exitFactor };
  };
}

/**
 * Replay a recommender across a candle series and evaluate each recommendation
 * against the actual future. The series should be one pair in anchor units.
 *
 * @param {{
 *   series: Array<object>,
 *   recommend?: (history: object[], point: object) => ({entryPrice:number,targetExit:number}|null),
 *   horizonHours?: number, size?: number,
 *   gold?: { goldPerTarget?: number|null, goldPerAnchor?: number|null },
 *   now?: number,
 * }} input
 */
export function backtestRecommendations({
  series,
  recommend = medianFactorRecommender(),
  horizonHours = 6,
  size = 1,
  gold = {},
  now = Date.now(),
} = {}) {
  const candles = (series ?? []).filter(validCandle).sort((a, b) => a.completedHour - b.completedHour);
  const trades = [];
  const results = [];
  for (let i = 0; i < candles.length; i += 1) {
    const point = candles[i];
    const rec = recommend(candles.slice(0, i + 1), point);
    if (!rec || !positive(rec.entryPrice) || !(rec.targetExit > rec.entryPrice)) continue;
    const trade = {
      target: point.target ?? null,
      anchor: point.anchor ?? null,
      entryHour: point.completedHour,
      entryPrice: rec.entryPrice,
      targetExit: rec.targetExit,
      horizonHours,
      size,
      goldPerTarget: gold.goldPerTarget ?? null,
      goldPerAnchor: gold.goldPerAnchor ?? null,
    };
    trades.push(trade);
    results.push(evaluatePaperTrade(trade, candles, { now }));
  }
  return { trades, results, summary: summarizePaperTrades(results), horizonHours };
}
