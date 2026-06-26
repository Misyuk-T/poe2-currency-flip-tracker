/**
 * Paper-trade engine — the honesty backbone of C3.
 *
 * Given a recommendation made at a completed hour (a limit-buy flip: buy `size`
 * of the target at `entryPrice`, take profit at `targetExit`, both in anchor
 * units), simulate the realised outcome over the next `horizonHours` using the
 * actual hourly candles that followed. Everything here is pure and
 * deterministic — no wall clock, no storage, no network — so a backtest is fully
 * reproducible and testable.
 *
 * Resolution is driven by DATA COVERAGE, not the real clock: an outcome is only
 * `entry-missed` / `open-at-horizon` once observed candles reach the end of the
 * horizon. Until then it stays `pending`/`open` — later hours could still fill
 * or hit the target. This is what lets the product talk about realised
 * paper-trade results honestly instead of inventing them.
 *
 * Two deliberately conservative choices avoid fabricating intrahour detail:
 *   - A take-profit can only fill on an hour AFTER the entry filled; within a
 *     single hourly low/high we cannot prove the high came after the limit buy.
 *   - A still-uncovered horizon is never marked to market.
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
 */
export function evaluatePaperTrade(trade, series) {
  const size = positive(trade?.size) ? trade.size : 1;
  if (!positive(trade?.entryPrice) || !positive(trade?.targetExit) || !Number.isFinite(trade?.entryHour)) {
    return { status: "invalid", reason: "missing-entry-exit-or-hour", filled: false, profit: null };
  }
  if (trade.targetExit <= trade.entryPrice) {
    return { status: "invalid", reason: "exit-not-above-entry", filled: false, profit: null };
  }

  const horizonHours = Math.max(1, Number(trade.horizonHours) || 1);
  const horizonEnd = trade.entryHour + horizonHours * HOUR;

  const candles = (series ?? []).filter(validCandle);
  const latestObserved = candles.reduce((m, c) => Math.max(m, c.completedHour), -Infinity);
  // The window is resolvable only once observed data reaches its end; before that
  // the outcome is genuinely unknown (a later hour could fill or hit the target).
  const horizonCovered = Number.isFinite(latestObserved) && latestObserved >= horizonEnd;

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

  const forward = candles
    .filter((c) => c.completedHour > trade.entryHour && c.completedHour <= horizonEnd)
    .sort((a, b) => a.completedHour - b.completedHour);

  if (!forward.length) {
    return { ...base, status: horizonCovered ? "no-data" : "pending" };
  }

  // Entry: a limit buy fills the first hour whose low reaches the entry price.
  const fillIndex = forward.findIndex((c) => c.low <= trade.entryPrice);
  if (fillIndex === -1) {
    return horizonCovered ? { ...base, status: "entry-missed", profit: 0, profitPct: 0 } : { ...base, status: "pending" };
  }
  const fillHour = forward[fillIndex].completedHour;
  const afterFill = forward.slice(fillIndex);

  // Take-profit can only fill on an hour strictly after the entry filled.
  const postFill = afterFill.slice(1);
  const exitRel = postFill.findIndex((c) => c.high >= trade.targetExit);
  const exitIndex = exitRel === -1 ? -1 : exitRel + 1; // index within afterFill

  let status;
  let exitPrice;
  let exitHour;
  let marked;
  if (exitIndex !== -1) {
    // A target hit in an observed hour is a definitive win regardless of whether
    // the rest of the horizon has been observed yet.
    status = "closed";
    exitPrice = trade.targetExit;
    exitHour = afterFill[exitIndex].completedHour;
    marked = false;
  } else if (horizonCovered) {
    // Filled, target never printed inside the fully-observed window → mark to
    // market at the last hour. This is where losses surface.
    status = "open-at-horizon";
    const last = afterFill[afterFill.length - 1];
    exitPrice = last.reference;
    exitHour = last.completedHour;
    marked = true;
  } else {
    // Filled, target not yet hit, horizon not yet covered by data → still holding.
    return {
      ...base,
      status: "open",
      filled: true,
      fillHour,
      maeFactor: Math.min(...afterFill.map((c) => c.low)) / trade.entryPrice - 1,
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
 * data has resolved (`closed` / `open-at-horizon` / `entry-missed`) count toward
 * the rates; `pending`/`open`/`no-data`/`invalid` are excluded but surfaced as
 * `pending` so a thin sample is never dressed up as a full record.
 *
 * Two distinct rates, never conflated:
 *   - `tpHitRate`     = closed (take-profit actually hit) / filled trades
 *   - `profitableRate`= filled trades that ended green (incl. mark-to-market) / filled
 */
export function summarizePaperTrades(results) {
  const all = (results ?? []).filter(Boolean);
  const resolvedStatuses = new Set(["closed", "open-at-horizon", "entry-missed"]);
  const resolved = all.filter((r) => resolvedStatuses.has(r.status));
  const taken = resolved.filter((r) => r.filled);
  const closedCount = taken.filter((r) => r.status === "closed").length;
  const profits = taken.map((r) => r.profit).filter(Number.isFinite);
  const profitableCount = profits.filter((p) => p > 0).length;
  const goldEff = taken.map((r) => r.profitPer100kGold).filter(Number.isFinite);

  return {
    evaluated: resolved.length,
    pending: all.length - resolved.length,
    taken: taken.length,
    closed: closedCount,
    openAtHorizon: taken.filter((r) => r.status === "open-at-horizon").length,
    entryMissed: resolved.filter((r) => r.status === "entry-missed").length,
    fillRate: resolved.length ? taken.length / resolved.length : null,
    tpHitRate: taken.length ? closedCount / taken.length : null,
    profitableRate: taken.length ? profitableCount / taken.length : null,
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
 * against the actual future. The series should be one pair in anchor units. The
 * recommender at hour T only sees history through T (no look-ahead); each
 * recommendation is then resolved by the engine's data-coverage rule.
 *
 * @param {{
 *   series: Array<object>,
 *   recommend?: (history: object[], point: object) => ({entryPrice:number,targetExit:number}|null),
 *   horizonHours?: number, size?: number,
 *   gold?: { goldPerTarget?: number|null, goldPerAnchor?: number|null },
 * }} input
 */
export function backtestRecommendations({
  series,
  recommend = medianFactorRecommender(),
  horizonHours = 6,
  size = 1,
  gold = {},
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
    results.push(evaluatePaperTrade(trade, candles));
  }
  return { trades, results, summary: summarizePaperTrades(results), horizonHours };
}
