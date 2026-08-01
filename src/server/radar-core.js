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
  icons = {},
  categories = {},
  canonicalId,
  now = Date.now(),
  radarMaxHotTargets = 8,
}) {
  const candles = await repo.readCandleWindow();
  // Fold history stored under a superseded currency id into the market it
  // belongs to, so a correction to the identity map takes effect on the next
  // read rather than after the old rows age out of the window.
  const byPair = groupCandlesByPair(candles, { canonicalId });
  const rowsByAnchor = Object.fromEntries(
    anchors.map((anchor) => [anchor, buildMarketRadar(byPair, { anchor, names, icons, categories, now })]),
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
  // Radar reads deliberately omit the stored reference scalar: candleForAnchor
  // recomputes the orientation-invariant geometric centre from the low/high
  // range. Count the same valid input here instead of transferring a redundant
  // column from Supabase for every pair/hour.
  const pricedCandleCount = candles.filter(
    (candle) => Number.isFinite(candle.low) && candle.low > 0
      && Number.isFinite(candle.high) && candle.high > 0,
  ).length;
  return {
    rowsByAnchor,
    hotlist,
    marketData: {
      status: candles.length === 0 ? "no-data" : pricedCandleCount === 0 ? "no-executed-trades" : "available",
      candleCount: candles.length,
      pricedCandleCount,
    },
  };
}

function radarPayloadFromComputed({
  computed,
  anchor,
  catalogManifest = [],
  catalogById = new Map(),
  source = null,
  now = Date.now(),
}) {
  const { rowsByAnchor, hotlist, marketData } = computed;
  const response = buildRadarResponse({
    radarRows: rowsByAnchor[anchor] ?? [],
    hotlistEntries: hotlist,
    catalogManifest,
    catalogById,
    anchor,
    source,
    now,
  });
  response.marketData = {
    ...marketData,
    trackedMarketCount: response.trackedCount,
    status:
      marketData.status === "available" && response.trackedCount === 0
        ? "no-anchor-markets"
        : marketData.status,
  };
  return response;
}

/**
 * Full /api/radar payloads for every configured anchor, computed from one
 * candle-window read. This is the background snapshot builder.
 */
export async function buildRadarPayloads({
  repo,
  anchors,
  shortlist = [],
  names = {},
  icons = {},
  categories = {},
  canonicalId,
  catalogManifest = [],
  catalogById = new Map(),
  source = null,
  now = Date.now(),
  radarMaxHotTargets = 8,
}) {
  const computed = await computeRadar({
    repo,
    anchors,
    shortlist,
    names,
    icons,
    categories,
    canonicalId,
    now,
    radarMaxHotTargets,
  });
  return Object.fromEntries(
    anchors.map((anchor) => [
      anchor,
      radarPayloadFromComputed({
        computed,
        anchor,
        catalogManifest,
        catalogById,
        source,
        now,
      }),
    ]),
  );
}

/** Full /api/radar payload for one anchor. */
export async function buildRadarPayload(input) {
  const anchors = [...new Set([...(input.anchors ?? []), input.anchor])];
  const payloads = await buildRadarPayloads({ ...input, anchors });
  return payloads[input.anchor];
}

/** /api/hotlist payload (the bare hotlist; scheduler is gone in serverless). */
export async function buildHotlistPayload({
  repo,
  anchors,
  shortlist = [],
  names = {},
  canonicalId,
  now = Date.now(),
  radarMaxHotTargets = 8,
}) {
  const { hotlist } = await computeRadar({ repo, anchors, shortlist, names, canonicalId, now, radarMaxHotTargets });
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
