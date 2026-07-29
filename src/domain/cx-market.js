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
export function normalizeCxDigest(payload, { digestId, league = null, leagues = null, translate = (id) => id } = {}) {
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
    // Ratio/volume/stock are keyed by the ORIGINAL market ids, so read them with
    // rawBase/rawQuote; `translate` maps those to the canonical id (short id where
    // known, else passthrough) used for base/quote/pairId and the JSON keys.
    const [rawBase, rawQuote] = parts;
    const lowRaw = ratioPrice(market.lowest_ratio, rawBase, rawQuote);
    const highRaw = ratioPrice(market.highest_ratio, rawBase, rawQuote);
    const valid = Number.isFinite(lowRaw) && Number.isFinite(highRaw) && lowRaw > 0 && highRaw > 0;
    const low = valid ? Math.min(lowRaw, highRaw) : null;
    const high = valid ? Math.max(lowRaw, highRaw) : null;
    const base = translate(rawBase);
    const quote = translate(rawQuote);
    if (!base || !quote || base === quote) continue; // guard against a collapsing translation
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
      // Centre of the reported range, NOT a close. See rangeCenter: geometric so
      // that a pair's storage orientation cannot change the price it implies.
      reference: valid ? rangeCenter(low, high) : null,
      referenceKind: "range-center-geometric",
      volume: {
        [base]: finiteNonNegative(market.volume_traded?.[rawBase]),
        [quote]: finiteNonNegative(market.volume_traded?.[rawQuote]),
      },
      stock: {
        lowest: {
          [base]: finiteNonNegative(market.lowest_stock?.[rawBase]),
          [quote]: finiteNonNegative(market.lowest_stock?.[rawQuote]),
        },
        highest: {
          [base]: finiteNonNegative(market.highest_stock?.[rawBase]),
          [quote]: finiteNonNegative(market.highest_stock?.[rawQuote]),
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
/**
 * Rewrite a stored candle's currency ids through a resolver.
 *
 * Ingest canonicalises ids as it writes, so a market's history splits the day
 * we learn a better id for it: rows written before the change keep the raw
 * Metadata path and show up as a second, phantom market alongside the real one
 * until they age out of the retention window. Applying the current mapping on
 * read merges the two halves immediately, and makes any future correction to
 * the identity map apply retroactively instead of needing a migration.
 *
 * `volume` and `stock` are keyed by currency id too, so they move with it.
 */
export function canonicalizeCandle(candle, canonicalId) {
  if (typeof canonicalId !== "function" || !candle) return candle;
  const base = canonicalId(candle.base);
  const quote = canonicalId(candle.quote);
  if (base === candle.base && quote === candle.quote) return candle;
  return {
    ...candle,
    base,
    quote,
    pairId: canonicalPairId(base, quote),
    volume: remapCurrencyKeys(candle.volume, canonicalId),
    stock: remapCurrencyKeys(candle.stock, canonicalId),
  };
}

function remapCurrencyKeys(record, canonicalId) {
  if (!record || typeof record !== "object") return record;
  const out = {};
  for (const [id, value] of Object.entries(record)) out[canonicalId(id)] = value;
  return out;
}

export function candleForAnchor(candle, target, anchor) {
  if (!candle || target === anchor) return null;
  const direct = candle.base === target && candle.quote === anchor;
  const inverse = candle.base === anchor && candle.quote === target;
  if (!direct && !inverse) return null;
  const low = direct ? candle.low : invert(candle.high);
  const high = direct ? candle.high : invert(candle.low);
  // Recomputed from the ORIENTED endpoints, never carried over or inverted from
  // the stored one. Inverting an arithmetic midpoint does not give the midpoint
  // of the inverted range — it gives the harmonic mean of it, which sits near
  // the bottom of the band. On production that put 83 of 627 markets at a price
  // far below the middle of their own range: Ancient Potent Liquid Melancholy
  // showed 3.64 against a reported 2–20, purely because GGG stored that pair the
  // other way round.
  //
  // Recomputing here also repairs history: every stored candle is re-centred on
  // read, so nothing needs migrating.
  return { ...candle, target, anchor, low, high, reference: rangeCenter(low, high) };
}

/**
 * The one scalar we print for a range, and the only one that survives inverting
 * the quote: the geometric centre is multiplicatively centred, so
 * `center(1/high, 1/low) === 1 / center(low, high)` exactly. An arithmetic
 * midpoint does not have that property, which is how a pair's orientation ended
 * up changing its price.
 *
 * It also refuses to be dragged by one extreme end the way a mean is: for a
 * reported 31–68 it reads 45.9 rather than 49.5. Narrow ranges are unaffected —
 * 46–50 gives 47.96 against 48.
 *
 * It is a CENTRE OF A RANGE, not a traded price. Nothing here observed a trade
 * at this number.
 */
export function rangeCenter(low, high) {
  if (!(Number.isFinite(low) && low > 0) || !(Number.isFinite(high) && high > 0)) return null;
  return Math.sqrt(low * high);
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
