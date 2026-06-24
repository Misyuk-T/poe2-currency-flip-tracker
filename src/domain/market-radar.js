import { candleForAnchor } from "./cx-market.js";

const HOUR = 3600_000;

export function buildMarketRadar(candlesByPair, { anchor, now = Date.now(), names = {}, minSamples = 3 } = {}) {
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
      targetName: names[target] ?? target,
      anchor,
      latestCompletedHour: latest.completedHour,
      reference: latest.reference,
      referenceKind: latest.referenceKind,
      low: latest.low,
      high: latest.high,
      // Keep the compact chart with the radar row so the list can render all
      // visible trends without an N+1 history request per market.
      sparkline24h: series.slice(-25).map((c) => c.reference),
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
  const movement = (hours) => {
    const xs = values(hours);
    if (xs.length < Math.max(2, Math.min(minSamples, hours + 1)) || xs[0].reference <= 0) return null;
    return xs[xs.length - 1].reference / xs[0].reference - 1;
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
  const signs = returns.map(Math.sign).filter((x) => x !== 0);
  const trendPersistence = signs.length ? Math.abs(signs.reduce((a, b) => a + b, 0)) / signs.length : null;
  const coverage24h = Math.min(1, Math.max(0, xs24.length - 1) / 24);
  const insufficient = xs24.length < minSamples;
  const activityScore = insufficient
    ? null
    : clamp100(
        30 * cappedAbs(movement6h, 0.12) +
          20 * cappedAbs(movement24h, 0.25) +
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
          10 * (1 - cappedAbs(movement24h, 0.25)),
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
