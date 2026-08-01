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

/**
 * One target per row across all anchor payloads. Prices stay in the selected
 * row's native anchor; callers use `sourceAnchor` for history and conversion.
 */
export function mergeRadarPayloads(payloads, { preferredAnchor } = {}) {
  const available = Object.entries(payloads ?? {}).filter(([, payload]) => payload?.rows);
  const anchors = available.map(([anchor]) => anchor);
  const preferred = anchors.includes(preferredAnchor) ? preferredAnchor : anchors[0] ?? preferredAnchor;
  const candidates = new Map();
  for (const [payloadAnchor, payload] of available) {
    for (const row of payload.rows ?? []) {
      if (!row?.pairId || row.status === "no-trades-this-hour") continue;
      const native = { ...row, anchor: row.anchor ?? payloadAnchor, sourceAnchor: row.anchor ?? payloadAnchor };
      const list = candidates.get(native.target) ?? [];
      list.push(native);
      candidates.set(native.target, list);
    }
  }

  const rows = [];
  for (const [target, targetRows] of candidates) {
    if (target === preferred) continue;
    // Core anchor markets define the conversion graph. Keep their direct quote
    // in the preferred anchor when it exists, avoiding inverse duplicates of
    // the same pair while retaining every non-anchor target.
    const preferredRows = anchors.includes(target)
      ? targetRows.filter((row) => row.anchor === preferred)
      : [];
    const pool = preferredRows.length ? preferredRows : targetRows;
    rows.push(pool.sort((a, b) => compareAnchorRows(a, b, preferred))[0]);
  }
  rows.sort((a, b) => (b.activityScore ?? -1) - (a.activityScore ?? -1) || String(a.target).localeCompare(String(b.target)));

  const primary = available.find(([anchor]) => anchor === preferred)?.[1] ?? available[0]?.[1] ?? {};
  const generatedAt = available
    .map(([, payload]) => Date.parse(payload.generatedAt))
    .filter(Number.isFinite)
    .reduce((latest, value) => Math.max(latest, value), 0);
  return {
    ...primary,
    anchor: preferred,
    availableAnchors: anchors,
    generatedAt: generatedAt ? new Date(generatedAt).toISOString() : primary.generatedAt,
    trackedCount: rows.length,
    catalogCount: rows.length,
    rows,
    marketData: {
      ...(primary.marketData ?? {}),
      trackedMarketCount: rows.length,
      status: rows.length ? "available" : primary.marketData?.status ?? "no-data",
    },
  };
}

function compareAnchorRows(a, b, preferredAnchor) {
  const values = [
    [Number(!a.stale), Number(!b.stale)],
    [Number(a.status === "ok"), Number(b.status === "ok")],
    [Number(a.samples) || 0, Number(b.samples) || 0],
    [Number(a.coverage24h) || 0, Number(b.coverage24h) || 0],
    [Number(a.volume) || 0, Number(b.volume) || 0],
    [Number(a.anchor === preferredAnchor), Number(b.anchor === preferredAnchor)],
  ];
  for (const [left, right] of values) {
    if (left !== right) return right - left;
  }
  return String(a.anchor).localeCompare(String(b.anchor));
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
