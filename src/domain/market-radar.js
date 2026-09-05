import { candleForAnchor } from "./cx-market.js";
import { humanize } from "./humanize.js";

const HOUR = 3600_000;

/**
 * How much of a movement window must actually be SPANNED for the change over it
 * to be published under that window's name. Counting samples is not enough:
 * three candles an hour apart satisfy any count check while spanning two hours,
 * which is how a young market published a two-hour change as "24h".
 *
 * 0.75 is measured, not guessed. Against live `hourly_market_candles`
 * (2026-09-05, Runes of Aldur, 1342 markets) an 18-hour span for h24 is cleared
 * by 1168 of them — 87%. The 13% that miss it are the sparse long tail whose
 * "24h" number was the least trustworthy on the site; they now render "—", which
 * is what the UI already does with a null movement. A stricter 23-hour span
 * would blank 27% of a mature league, which is a different product.
 */
const MIN_SPAN_RATIO = 0.75;

export function buildMarketRadar(
  candlesByPair,
  { anchor, now = Date.now(), names = {}, icons = {}, categories = {}, minSamples = 3 } = {},
) {
  const rows = [];
  for (const candles of Object.values(candlesByPair ?? {})) {
    const first = candles?.[0];
    if (!first) continue;
    const target = first.base === anchor ? first.quote : first.quote === anchor ? first.base : null;
    if (!target) continue;
    const series = candles
      .map((c) => candleForAnchor(c, target, anchor))
      .filter((c) => c && Number.isFinite(c.reference))
      .sort((a, b) => a.completedHour - b.completedHour);
    if (!series.length) continue;
    const latest = series[series.length - 1];
    const metrics = radarMetrics(series, { now, minSamples });
    rows.push({
      pairId: latest.pairId,
      target,
      targetName: names[target] ?? humanize(target),
      targetIcon: icons[target] ?? null,
      category: categories[target] ?? null,
      anchor,
      latestCompletedHour: latest.completedHour,
      reference: latest.reference,
      referenceKind: latest.referenceKind,
      low: latest.low,
      high: latest.high,
      // Keep the compact chart with the radar row so the list can render all
      // visible trends without an N+1 history request per market.
      sparkline24h: series.slice(-25).map((c) => c.reference),
      // The hour the sparkline STARTS at. "Last 25 candles" is not "the last 24
      // hours" — in a young or sparse market it can be a fraction of that — and
      // consumers that compute their own change from these points (the key
      // currency cards) need the real span to know whether they may call it a
      // 24h move. Same judgement as MIN_SPAN_RATIO, one level up.
      sparklineFromHour: series.slice(-25)[0].completedHour,
      ...metrics,
    });
  }
  return rows.sort((a, b) => (b.activityScore ?? -1) - (a.activityScore ?? -1));
}

/**
 * Collapse per-anchor radar rows for the same target to the single most
 * "interesting" row (highest activity/arbitrage). Used to derive one hotlist
 * across all anchors.
 */
export function dedupeRadarRows(rows) {
  const byTarget = new Map();
  for (const row of rows) {
    const old = byTarget.get(row.target);
    const score = Math.max(row.activityScore ?? -1, row.arbitrageScore ?? -1);
    const oldScore = Math.max(old?.activityScore ?? -1, old?.arbitrageScore ?? -1);
    if (!old || score > oldScore) byTarget.set(row.target, row);
  }
  return [...byTarget.values()];
}

export function radarMetrics(series, { now = Date.now(), minSamples = 3 } = {}) {
  const latest = series[series.length - 1];
  // A movement over N hours needs both endpoints: the latest candle and the
  // candle N completed hours earlier. Returning 0 from a single candle would
  // falsely mean "flat", so sparse windows remain null.
  const values = (hours) => series.filter((c) => c.completedHour >= latest.completedHour - hours * HOUR);
  const counted = (xs, hours) =>
    xs.length >= Math.max(2, Math.min(minSamples, hours + 1)) && xs[0].reference > 0;
  const change = (xs) => xs[xs.length - 1].reference / xs[0].reference - 1;
  /**
   * The PUBLISHED movement: counted, and with the window actually spanned (see
   * MIN_SPAN_RATIO). Null when it is not — the tables render "—" rather than a
   * shorter change wearing a longer window's label.
   */
  const movement = (hours) => {
    const xs = values(hours);
    if (!counted(xs, hours)) return null;
    if (latest.completedHour - xs[0].completedHour < MIN_SPAN_RATIO * hours * HOUR) return null;
    return change(xs);
  };
  /**
   * The SCORING input: counted only, no span requirement — deliberately the
   * pre-2026-09-05 definition. cappedAbs() reads null as zero movement, so
   * feeding the strict value into the scores would quietly re-rank the hotlist,
   * making every sparse market look motionless (calm = high arbitrage score).
   * Tightening what we publish must not change what we rank.
   */
  const scoreMovement = (hours) => {
    const xs = values(hours);
    return counted(xs, hours) ? change(xs) : null;
  };
  const xs24 = values(24);
  const returns = [];
  for (let i = 1; i < xs24.length; i++) {
    if (xs24[i - 1].reference > 0 && xs24[i].reference > 0) returns.push(Math.log(xs24[i].reference / xs24[i - 1].reference));
  }
  const volatility24h = returns.length >= minSamples - 1 ? stdev(returns) : null;
  const rangePct = latest.low > 0 && latest.high > 0 ? (latest.high - latest.low) / latest.reference : null;
  const targetVolume = (c) => Number(c.volume?.[c.target] ?? c.volume?.[c.base]);
  const recent = xs24.slice(-3).map(targetVolume).filter(Number.isFinite);
  const prior = xs24.slice(-6, -3).map(targetVolume).filter(Number.isFinite);
  const recentAvg = avg(recent);
  const priorAvg = avg(prior);
  const volumeAcceleration = recentAvg != null && priorAvg > 0 ? recentAvg / priorAvg : null;
  const movement6h = movement(6);
  const movement12h = movement(12);
  const movement24h = movement(24);
  const scored6h = scoreMovement(6);
  const scored24h = scoreMovement(24);
  const signs = returns.map(Math.sign).filter((x) => x !== 0);
  const trendPersistence = signs.length ? Math.abs(signs.reduce((a, b) => a + b, 0)) / signs.length : null;
  const coverage24h = Math.min(1, Math.max(0, xs24.length - 1) / 24);
  const insufficient = xs24.length < minSamples;
  const activityScore = insufficient
    ? null
    : clamp100(
        30 * cappedAbs(scored6h, 0.12) +
          20 * cappedAbs(scored24h, 0.25) +
          20 * capped(volatility24h, 0.08) +
          15 * capped((volumeAcceleration ?? 1) - 1, 2) +
          10 * (trendPersistence ?? 0) +
          5 * coverage24h,
      );
  const arbitrageScore = insufficient
    ? null
    : clamp100(
        35 * (1 - capped(volatility24h, 0.08)) +
          20 * (1 - capped(rangePct, 0.15)) +
          20 * capped(Math.log10(1 + (recentAvg ?? 0)), 5) +
          15 * coverage24h +
          10 * (1 - cappedAbs(scored24h, 0.25)),
      );
  return {
    status: insufficient ? "insufficient-history" : "ok",
    samples: xs24.length,
    coverage24h,
    stale: now - latest.completedHour > 2 * HOUR,
    movement: { h1: movement(1), h3: movement(3), h6: movement6h, h12: movement12h, h24: movement24h },
    rangePct,
    volatility24h,
    volume: recentAvg,
    volumeAcceleration,
    trendPersistence,
    activityScore,
    arbitrageScore,
  };
}

function avg(values) {
  const xs = values.filter(Number.isFinite);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}
function stdev(values) {
  const mean = avg(values);
  return mean == null ? null : Math.sqrt(avg(values.map((x) => (x - mean) ** 2)));
}
function capped(value, max) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value / max)) : 0;
}
function cappedAbs(value, max) {
  return capped(Math.abs(value ?? 0), max);
}
function clamp100(value) {
  return Math.round(Math.max(0, Math.min(100, value)) * 10) / 10;
}
