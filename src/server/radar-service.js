import { normalizeCxDigest, candleForAnchor } from "../domain/cx-market.js";
import { buildMarketRadar } from "../domain/market-radar.js";
import { buildHotlist } from "../domain/hotlist.js";
import { buildCxapiFixtures } from "../data/fixtures/cxapi-fixtures.js";

const HOUR = 3600_000;

export function createRadarService({ config, storage, cxapiProvider, names = {}, fixtureItems = [], fixtureMode = false, onHotlist = () => {} }) {
  let rowsByAnchor = {};
  let hotlist = [];
  let lastSuccessAt = 0;
  let lastAttemptAt = 0;
  let lastError = null;
  let refreshing = null;

  async function init() {
    const expectedFixturePairs = fixtureItems.length ? fixtureItems.length : 4;
    if (fixtureMode && storage.hourly().state().pairCount < expectedFixturePairs) {
      const endHour = Math.floor(Date.now() / HOUR) * 3600 - 3600;
      for (const d of buildCxapiFixtures({ league: config.league, endHour, items: fixtureItems, anchors: config.anchors })) {
        const normalized = normalizeCxDigest(d.payload, { digestId: d.digestId, league: config.league });
        normalized.candles = normalized.candles.map((c) => ({ ...c, source: "fixture-cxapi", synthetic: true }));
        await storage.recordHourlyDigest(normalized);
      }
      lastSuccessAt = Date.now();
    }
    recompute();
  }

  function recompute() {
    const all = storage.hourly().all();
    rowsByAnchor = Object.fromEntries(
      config.anchors.map((anchor) => [anchor, buildMarketRadar(all, { anchor, names, now: Date.now() })]),
    );
    const union = dedupeRadar(Object.values(rowsByAnchor).flat());
    hotlist = buildHotlist({
      pinned: config.shortlist,
      radar: union,
      previous: hotlist,
      maxTargets: config.radarMaxHotTargets,
      minTenureMs: config.radarMinTenureMs,
    });
    onHotlist(hotlist);
  }

  function refresh({ maxDigests = 1 } = {}) {
    if (refreshing) return refreshing;
    if (!cxapiProvider.configured) return undefined;
    refreshing = (async () => {
      lastAttemptAt = Date.now();
      try {
        let id = storage.hourly().state().cursor ?? config.cxapiStartId;
        const limit = Math.max(1, Math.min(Number(maxDigests) || 1, config.cxapiMaxBackfillHours));
        let inserted = 0;
        let completed = 0;
        let lastDigestId = null;
        for (let i = 0; i < limit; i++) {
          const requestedId = id;
          const raw = await cxapiProvider.fetchDigest({ id });
          const normalized = normalizeCxDigest(raw.payload, { digestId: raw.digestId, league: config.league });
          inserted += await storage.recordHourlyDigest(normalized);
          completed++;
          lastDigestId = normalized.digestId;
          id = normalized.nextChangeId;
          // The no-id endpoint gives us the latest completed digest. Do not
          // request into the future; historical catch-up only follows an
          // already-persisted/configured cursor.
          if (requestedId == null || id == null || id <= normalized.digestId) break;
        }
        lastSuccessAt = Date.now();
        lastError = null;
        recompute();
        return { ok: true, digestId: lastDigestId, digests: completed, inserted };
      } catch (err) {
        lastError = { code: err.code ?? "cxapi-failed", message: "hourly market source unavailable" };
        return { ok: false, error: lastError };
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  function radar(anchor) {
    return rowsByAnchor[anchor] ?? [];
  }

  function history(pairId, anchor) {
    const candles = storage.hourly().get(pairId);
    if (!anchor) return candles;
    const first = candles[0];
    if (!first) return [];
    const target = first.base === anchor ? first.quote : first.quote === anchor ? first.base : null;
    return target ? candles.map((c) => candleForAnchor(c, target, anchor)).filter(Boolean) : [];
  }

  function status() {
    const state = storage.hourly().state();
    const latestHour = Math.max(0, ...Object.values(storage.hourly().all()).flat().map((c) => c.completedHour));
    return {
      enabled: true,
      sourceMode: fixtureMode ? "fixture" : cxapiProvider.configured ? "official" : "waiting-oauth",
      configured: cxapiProvider.configured,
      lastSuccessAt: lastSuccessAt ? new Date(lastSuccessAt).toISOString() : null,
      lastAttemptAt: lastAttemptAt ? new Date(lastAttemptAt).toISOString() : null,
      lastError,
      lastDigestId: state.lastDigestId,
      cursorPresent: state.cursor != null,
      pairCount: state.pairCount,
      candleCount: state.candleCount,
      latestCompletedHour: latestHour ? new Date(latestHour).toISOString() : null,
      ingestionLagMs: latestHour ? Date.now() - latestHour : null,
      hotlistSize: hotlist.length,
    };
  }

  return { init, refresh, radar, history, hotlist: () => [...hotlist], status, recompute };
}

function dedupeRadar(rows) {
  const byTarget = new Map();
  for (const row of rows) {
    const old = byTarget.get(row.target);
    const score = Math.max(row.activityScore ?? -1, row.arbitrageScore ?? -1);
    const oldScore = Math.max(old?.activityScore ?? -1, old?.arbitrageScore ?? -1);
    if (!old || score > oldScore) byTarget.set(row.target, row);
  }
  return [...byTarget.values()];
}
