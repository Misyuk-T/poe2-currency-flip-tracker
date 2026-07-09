/**
 * Pure shaping of the /api/radar response. Extracted from the HTTP handler so
 * the always-on Node server and the serverless Next.js route handlers produce
 * an IDENTICAL contract from the same code. No I/O, no clock of its own — pass
 * `now` in.
 *
 * It merges computed radar rows with the full catalog: every catalog item that
 * had no trades this hour is still listed (status "no-trades-this-hour") so the
 * UI never silently drops a market.
 */

import { adaptiveMarketPrice, divineInExalted } from "./market-price-display.js";

/** A catalog item with no hourly trades, shaped like a radar row but empty. */
function noTradeRow(item, anchor) {
  return {
    pairId: null,
    target: item.id,
    targetName: item.name,
    category: item.category,
    subcategory: item.subcategory,
    catalogOrder: item.catalogOrder,
    anchor,
    status: "no-trades-this-hour",
    samples: 0,
    latestCompletedHour: null,
    reference: null,
    referenceKind: null,
    low: null,
    high: null,
    sparkline24h: [],
    movement: { h1: null, h3: null, h6: null, h12: null, h24: null },
    rangePct: null,
    volatility24h: null,
    volume: null,
    volumeAcceleration: null,
    trendPersistence: null,
    coverage24h: 0,
    stale: false,
    activityScore: null,
    arbitrageScore: null,
    hotlist: null,
    gold: { status: item.status, goldPerUnit: item.goldPerUnit },
  };
}

/**
 * @param {{
 *   radarRows?: any[],
 *   hotlistEntries?: Array<{ id: string }>,
 *   catalogManifest?: any[],
 *   catalogById?: Map<string, any>,
 *   anchor: string,
 *   source?: any,
 *   now?: number,
 * }} input
 */
export function buildRadarResponse({
  radarRows = [],
  hotlistEntries = [],
  catalogManifest = [],
  catalogById = new Map(),
  anchor,
  source = null,
  now = Date.now(),
}) {
  const hot = new Map(hotlistEntries.map((entry) => [entry.id, entry]));
  const tracked = radarRows.map((row) => {
    const item = catalogById.get(row.target);
    return {
      ...row,
      hotlist: hot.get(row.target) ?? null,
      category: item?.category ?? null,
      subcategory: item?.subcategory ?? item?.category ?? null,
      catalogOrder: item?.catalogOrder ?? 999999,
      gold: item
        ? { status: item.status, goldPerUnit: item.goldPerUnit }
        : { status: "unknown-catalog-item", goldPerUnit: null },
    };
  });
  const trackedIds = new Set(tracked.map((row) => row.target));
  const missing = catalogManifest
    .filter((item) => item.id !== anchor && !trackedIds.has(item.id))
    .map((item) => noTradeRow(item, anchor));

  const rawRows = [...tracked, ...missing];
  const currentDivineInExalted = divineInExalted(tracked, anchor);
  const rows = rawRows.map((row) => ({
    ...row,
    displayPrice: adaptiveMarketPrice(row.reference, { anchor, divineInExalted: currentDivineInExalted }),
  }));

  return {
    anchor,
    // Gold-per-unit of the anchor currency, so the browser can price the exit leg
    // of a round trip (gold is charged on the anchor received when selling back).
    // Placeholder-flat today; real per-currency value once live gold data lands.
    goldPerAnchor: catalogById.get(anchor)?.goldPerUnit ?? null,
    units: { divineInExalted: currentDivineInExalted },
    generatedAt: new Date(now).toISOString(),
    source,
    trackedCount: tracked.length,
    catalogCount: tracked.length + missing.length,
    rows,
  };
}
