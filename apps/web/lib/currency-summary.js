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
import { canonicalPairId } from "../../../src/domain/cx-market.js";
import { buildMarketRadar } from "../../../src/domain/market-radar.js";
import { createRadarRepository } from "../../../src/storage/radar-repository.js";
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
    samples: row.samples,
    latestCompletedHour: row.latestCompletedHour ? new Date(row.latestCompletedHour).toISOString() : null,
  };
}
