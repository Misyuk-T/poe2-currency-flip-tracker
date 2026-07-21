/** Normalize GGG Currency Exchange hourly digests without inventing OHLC data. */

export function canonicalPairId(a, b) {
  return [String(a), String(b)].sort().join("|");
}

/**
 * Public leagues only. GGG's CX stream mixes permanent + challenge leagues with
 * transient PRIVATE leagues, tagged `... (PLxxxxx)`. Private leagues are tiny,
 * throwaway, and pure noise for a market tracker — exclude them.
 */
export function isPublicLeague(name) {
  return typeof name === "string" && name.length > 0 && !/\(PL\d+\)/.test(name);
}

/**
 * Normalize one hourly digest into per-market candles.
 *
 * One CDN stream (per game/realm) carries EVERY league in each hour, so league
 * selection happens here, and each candle carries its OWN league:
 *  - `league` given  -> keep only that exact league (legacy single-league path).
 *  - `leagues` given -> keep leagues in that allow-list (exact match).
 *  - neither         -> keep ALL public leagues (multi-game/all-league ingest).
 */
export function normalizeCxDigest(payload, { digestId, league = null, leagues = null } = {}) {
  if (!payload || !Array.isArray(payload.markets)) throw new Error("cxapi digest missing markets array");
  const hour = finiteInt(digestId);
  if (hour == null) throw new Error("cxapi digest id must be a unix-hour timestamp");
  const allow = leagues ? new Set(leagues) : null;
  const keepLeague = (name) => {
    if (league != null) return name === league;
    if (allow) return allow.has(name);
    return isPublicLeague(name);
  };
  const completedHour = hour * 1000;
  const candles = [];
  for (const market of payload.markets) {
    if (!market || typeof market.market_id !== "string" || !keepLeague(market.league)) continue;
    const marketLeague = market.league;
    const parts = market.market_id.split("|");
    if (parts.length !== 2 || !parts[0] || !parts[1] || parts[0] === parts[1]) continue;
    const [base, quote] = parts;
    const lowRaw = ratioPrice(market.lowest_ratio, base, quote);
    const highRaw = ratioPrice(market.highest_ratio, base, quote);
    const valid = Number.isFinite(lowRaw) && Number.isFinite(highRaw) && lowRaw > 0 && highRaw > 0;
    const low = valid ? Math.min(lowRaw, highRaw) : null;
    const high = valid ? Math.max(lowRaw, highRaw) : null;
    candles.push({
      source: "ggg-cxapi",
      league: marketLeague,
      completedHour,
      digestId: hour,
      pairId: canonicalPairId(base, quote),
      base,
      quote,
      low,
      high,
      reference: valid ? (low + high) / 2 : null, // range midpoint proxy, NOT a close
      referenceKind: "range-midpoint-proxy",
      volume: {
        [base]: finiteNonNegative(market.volume_traded?.[base]),
        [quote]: finiteNonNegative(market.volume_traded?.[quote]),
      },
      stock: {
        lowest: {
          [base]: finiteNonNegative(market.lowest_stock?.[base]),
          [quote]: finiteNonNegative(market.lowest_stock?.[quote]),
        },
        highest: {
          [base]: finiteNonNegative(market.highest_stock?.[base]),
          [quote]: finiteNonNegative(market.highest_stock?.[quote]),
        },
      },
    });
  }
  return {
    digestId: hour,
    nextChangeId: finiteInt(payload.next_change_id),
    candles,
  };
}

/** Return target price in anchor units; inverse orientation is handled exactly. */
export function candleForAnchor(candle, target, anchor) {
  if (!candle || target === anchor) return null;
  const direct = candle.base === target && candle.quote === anchor;
  const inverse = candle.base === anchor && candle.quote === target;
  if (!direct && !inverse) return null;
  if (direct) return { ...candle, target, anchor, low: candle.low, high: candle.high, reference: candle.reference };
  const low = invert(candle.high);
  const high = invert(candle.low);
  const reference = invert(candle.reference);
  return { ...candle, target, anchor, low, high, reference };
}

function ratioPrice(ratio, base, quote) {
  const b = Number(ratio?.[base]);
  const q = Number(ratio?.[quote]);
  return Number.isFinite(b) && Number.isFinite(q) && b > 0 && q > 0 ? q / b : null;
}

function invert(value) {
  return Number.isFinite(value) && value > 0 ? 1 / value : null;
}

function finiteInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function finiteNonNegative(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
