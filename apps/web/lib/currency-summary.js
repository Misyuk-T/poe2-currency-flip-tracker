/**
 * Slim, catalog-free read for the SEO (ISR) currency pages: the latest stored
 * summary for one currency vs the anchor. Deliberately avoids importing the
 * catalog loader (which computes a file URL at module load and breaks Next's
 * page-config collection in a VM context) — the page already knows the name.
 *
 * Returns null when there's no database or no data for the pair, so the page
 * renders its static fallback. Import this dynamically inside the component.
 */

import { loadConfig } from "../../../src/server/config.js";
import { canonicalPairId, candleForAnchor } from "../../../src/domain/cx-market.js";
import { buildMarketRadar } from "../../../src/domain/market-radar.js";
import { createRadarRepository, groupCandlesByPair } from "../../../src/storage/radar-repository.js";
import { getSql } from "./db.js";

export async function getCurrencySummary(id) {
  const config = loadConfig();
  if (!id || id === config.anchorCurrency) return null;
  const sql = getSql();
  if (!sql) return null;

  const scope = { game: config.poeGame, realm: config.poeRealm, league: config.league, mode: config.providerMode };
  const repo = createRadarRepository({ sql, scope });
  const pairId = canonicalPairId(id, config.anchorCurrency);
  const candles = await repo.readPairCandles(pairId);
  if (!candles.length) return null;

  const rows = buildMarketRadar({ [pairId]: candles }, { anchor: config.anchorCurrency, now: Date.now() });
  const row = rows.find((r) => r.target === id);
  if (!row) return null;
  const series = candles
    .map((c) => candleForAnchor(c, id, config.anchorCurrency))
    .filter(
      (c) =>
        c &&
        Number.isFinite(c.completedHour) &&
        Number.isFinite(c.low) &&
        Number.isFinite(c.high) &&
        Number.isFinite(c.reference),
    )
    .sort((a, b) => a.completedHour - b.completedHour)
    .slice(-25)
    .map((c) => ({
      completedHour: new Date(c.completedHour).toISOString(),
      low: c.low,
      high: c.high,
      reference: c.reference,
    }));

  return {
    target: id,
    anchor: config.anchorCurrency,
    sourceMode: config.providerMode === "live" ? "official" : "fixture",
    reference: row.reference,
    referenceKind: row.referenceKind,
    low: row.low,
    high: row.high,
    rangePct: row.rangePct,
    movement: row.movement,
    activityScore: row.activityScore,
    samples: row.samples,
    series,
    latestCompletedHour: row.latestCompletedHour ? new Date(row.latestCompletedHour).toISOString() : null,
  };
}

/**
 * Pure: shape a full candle window (grouped by pair) into a slim per-id index
 * for the currency list page and the sitemap. One radar pass against the anchor
 * yields a price + 24h move per target without an N+1 read per currency.
 * Returns a plain (serializable) object keyed by target id.
 */
export function buildCurrencyIndex(candlesByPair, { anchor, sourceMode = "fixture", now = Date.now() } = {}) {
  const rows = buildMarketRadar(candlesByPair, { anchor, now });
  const byId = {};
  let latestMs = 0;
  for (const row of rows) {
    const hourMs = Number.isFinite(row.latestCompletedHour) ? row.latestCompletedHour : null;
    if (hourMs && hourMs > latestMs) latestMs = hourMs;
    byId[row.target] = {
      target: row.target,
      reference: row.reference,
      referenceKind: row.referenceKind,
      low: row.low,
      high: row.high,
      rangePct: row.rangePct,
      movement: row.movement,
      samples: row.samples,
      stale: row.stale,
      latestCompletedHour: hourMs ? new Date(hourMs).toISOString() : null,
      latestCompletedHourMs: hourMs,
    };
  }
  return {
    anchor,
    sourceMode,
    byId,
    latestCompletedHour: latestMs ? new Date(latestMs).toISOString() : null,
    latestCompletedHourMs: latestMs || null,
  };
}

/**
 * Pure: the sitemap URL set for currency pages — the union of always-listed
 * popular currencies and every currency that has stored market data, each with
 * a `lastModifiedMs` (its own latest completed hour when known). We deliberately
 * do NOT enumerate all catalog ids: a URL only earns a sitemap entry once it has
 * real, unique data behind it, which avoids hundreds of thin, near-duplicate
 * pages. Framework-agnostic (returns ms, not Date) so it is trivially testable.
 */
export function currencySitemapUrls(index, { popularIds = [], nowMs = Date.now() } = {}) {
  const byId = new Map();
  for (const id of popularIds) byId.set(id, nowMs);
  for (const [id, stat] of Object.entries(index?.byId ?? {})) {
    byId.set(id, Number.isFinite(stat?.latestCompletedHourMs) ? stat.latestCompletedHourMs : index?.latestCompletedHourMs ?? nowMs);
  }
  return [...byId.entries()].map(([id, lastModifiedMs]) => ({ id, lastModifiedMs }));
}

/**
 * Slim multi-currency read for the list page + sitemap: the latest stored price
 * and 24h movement for every target vs the configured anchor, from a single
 * bounded candle-window read. Returns null when there's no database or no data
 * so callers render their static fallback. Import this dynamically inside the
 * component (keeps the DB driver out of Next's page-config collection pass).
 */
export async function getCurrencyIndex() {
  const config = loadConfig();
  const sql = getSql();
  if (!sql) return null;

  const scope = { game: config.poeGame, realm: config.poeRealm, league: config.league, mode: config.providerMode };
  const repo = createRadarRepository({ sql, scope });
  const candles = await repo.readCandleWindow();
  if (!candles.length) return null;

  return buildCurrencyIndex(groupCandlesByPair(candles), {
    anchor: config.anchorCurrency,
    sourceMode: config.providerMode === "live" ? "official" : "fixture",
    now: Date.now(),
  });
}
