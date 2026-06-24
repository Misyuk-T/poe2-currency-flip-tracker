/**
 * Stateless radar computation for serverless reads (Next.js Route Handlers,
 * cron). It loads the bounded candle window once per call, computes radar rows
 * per anchor with the pure domain functions, derives a hotlist, and shapes the
 * response with the shared builder — the same contract the always-on server
 * serves, with no in-process state.
 *
 * Difference from the always-on radar-service: there is NO cross-request hotlist
 * tenure smoothing (that relied on a long-lived `previous` list). Each read
 * recomputes the hotlist from the current window, which is deterministic and
 * fine for a read endpoint.
 */

import { candleForAnchor } from "../domain/cx-market.js";
import { buildMarketRadar, dedupeRadarRows } from "../domain/market-radar.js";
import { buildHotlist } from "../domain/hotlist.js";
import { buildRadarResponse } from "../domain/radar-payload.js";
import { groupCandlesByPair } from "../storage/radar-repository.js";

/** Compute radar rows per anchor + a fresh hotlist from the loaded window. */
async function computeRadar({
  repo,
  anchors,
  shortlist = [],
  names = {},
  now = Date.now(),
  radarMaxHotTargets = 8,
}) {
  const candles = await repo.readCandleWindow();
  const byPair = groupCandlesByPair(candles);
  const rowsByAnchor = Object.fromEntries(
    anchors.map((anchor) => [anchor, buildMarketRadar(byPair, { anchor, names, now })]),
  );
  const union = dedupeRadarRows(Object.values(rowsByAnchor).flat());
  const hotlist = buildHotlist({
    pinned: shortlist,
    radar: union,
    previous: [],
    maxTargets: radarMaxHotTargets,
    now,
    minTenureMs: 0, // no prior state to retain in a stateless read
  });
  return { rowsByAnchor, hotlist };
}

/**
 * Full /api/radar payload for one anchor.
 * @param {{
 *   repo: any, anchor: string, anchors: string[], shortlist?: string[],
 *   names?: object, catalogManifest?: any[], catalogById?: Map<string, any>,
 *   source?: any, now?: number, radarMaxHotTargets?: number,
 * }} input
 */
export async function buildRadarPayload({
  repo,
  anchor,
  anchors,
  shortlist = [],
  names = {},
  catalogManifest = [],
  catalogById = new Map(),
  source = null,
  now = Date.now(),
  radarMaxHotTargets = 8,
}) {
  const { rowsByAnchor, hotlist } = await computeRadar({ repo, anchors, shortlist, names, now, radarMaxHotTargets });
  return buildRadarResponse({
    radarRows: rowsByAnchor[anchor] ?? [],
    hotlistEntries: hotlist,
    catalogManifest,
    catalogById,
    anchor,
    source,
    now,
  });
}

/** /api/hotlist payload (the bare hotlist; scheduler is gone in serverless). */
export async function buildHotlistPayload({
  repo,
  anchors,
  shortlist = [],
  names = {},
  now = Date.now(),
  radarMaxHotTargets = 8,
}) {
  const { hotlist } = await computeRadar({ repo, anchors, shortlist, names, now, radarMaxHotTargets });
  return { entries: hotlist, scheduler: { enabled: false } };
}

/** /api/radar/history payload: one pair's series in the requested anchor units. */
export async function buildHistoryPayload({ repo, pair, anchor }) {
  const candles = await repo.readPairCandles(pair);
  if (!anchor) return { pair, anchor, series: candles };
  const first = candles[0];
  if (!first) return { pair, anchor, series: [] };
  const target = first.base === anchor ? first.quote : first.quote === anchor ? first.base : null;
  const series = target ? candles.map((c) => candleForAnchor(c, target, anchor)).filter(Boolean) : [];
  return { pair, anchor, series };
}
