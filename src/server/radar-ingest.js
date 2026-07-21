/**
 * Radar ingestion: write hourly market candles into Postgres. Used by the
 * serverless cron route (D3). Two modes, mirroring the always-on radar-service:
 *
 *  - fixtures: synthesize the deterministic offline history (clearly labelled
 *    synthetic) so a deployed instance has demonstrable data with no live API.
 *  - live: cursor-based catch-up from the official OAuth-gated cxapi.
 *
 * Both are safe to run concurrently/repeatedly: recordCxDigest is idempotent
 * (candles dropped by primary key) and advances the cursor monotonically, so no
 * distributed lock is needed (which also avoids session-advisory-lock pitfalls
 * under transaction pooling).
 */

import { normalizeCxDigest } from "../domain/cx-market.js";
import { buildCxapiFixtures } from "../data/fixtures/cxapi-fixtures.js";
import { resolveCurrency } from "../domain/cx-identity.js";

/** Map a live PoE2 CX Metadata id to its canonical id (catalog short id where
 *  known, else the Metadata path). A no-op for ids outside the identity map
 *  (e.g. fixture short ids). */
export const metadataToCanonicalId = (id) => resolveCurrency(id).shortId ?? id;

/** The identity map is PoE2-specific, so only PoE2 gets canonicalized; other
 *  games (PoE1, console) pass through until they get their own identity map —
 *  never risk labelling PoE1 data with PoE2 short ids. */
export function translatorForGame(game) {
  return game === "poe2" ? metadataToCanonicalId : (id) => id;
}

const HOUR = 3600_000;

/**
 * Synthesize and persist the offline fixture history. Defaults to the featured
 * markets (divine/chaos/vaal/essence) — a small, fast, demonstrable set — rather
 * than the whole catalog.
 * @param {{ repo: any, league: string, anchors: string[], items?: any[], now?: number }} input
 */
export async function ingestFixtures({ repo, league, anchors, items = [], now = Date.now() }) {
  const endHour = Math.floor(now / HOUR) * 3600 - 3600; // last completed hour, in unix seconds
  let inserted = 0;
  let digests = 0;
  for (const d of buildCxapiFixtures({ league, endHour, items, anchors })) {
    const normalized = normalizeCxDigest(d.payload, { digestId: d.digestId, league });
    normalized.candles = normalized.candles.map((c) => ({ ...c, source: "fixture-cxapi", synthetic: true }));
    inserted += await repo.recordCxDigest(normalized);
    digests += 1;
  }
  return { mode: "fixture", configured: true, digests, inserted };
}

/**
 * Cursor-based catch-up from the official cxapi. Stops as soon as it reaches the
 * latest completed digest (never requests into the future).
 * @param {{ repo: any, provider: any, league: string, startId?: number|null, maxDigests?: number }} input
 */
export async function ingestLive({ repo, provider, league = null, leagues = null, startId = null, maxDigests = 1, translate = (id) => id }) {
  if (!provider?.configured) return { mode: "live", configured: false, digests: 0, inserted: 0 };
  const state = await repo.readCxapiState();
  let id = state.cursor ?? startId;
  const limit = Math.max(1, Number(maxDigests) || 1);
  let inserted = 0;
  let digests = 0;
  let lastDigestId = null;
  for (let i = 0; i < limit; i += 1) {
    const requestedId = id;
    const raw = await provider.fetchDigest({ id });
    // league/leagues null => keep ALL public leagues (multi-league live ingest).
    // translate => canonicalize Metadata ids to short ids where known.
    const normalized = normalizeCxDigest(raw.payload, { digestId: raw.digestId, league, leagues, translate });
    inserted += await repo.recordCxDigest(normalized);
    digests += 1;
    lastDigestId = normalized.digestId;
    id = normalized.nextChangeId;
    // The no-id endpoint returns the latest completed digest; do not loop into
    // the future. Historical catch-up only follows a real prior cursor.
    if (requestedId == null || id == null || id <= normalized.digestId) break;
  }
  return { mode: "live", configured: true, digests, inserted, lastDigestId };
}

/** Last completed hour minus a bounded backfill window, in unix seconds. */
export function recentStartHour(nowMs, backfillHours) {
  const lastCompleted = Math.floor(nowMs / 3600_000) * 3600 - 3600;
  return lastCompleted - Math.max(1, Math.min(backfillHours, 48)) * 3600;
}

/**
 * Ingest every configured live stream — one CDN stream per (game, realm), each
 * carrying all public leagues and its own per-(game,realm) cursor. Dependencies
 * (makeRepo/makeProvider) are injected so the orchestration is testable without a
 * database. Streams run sequentially: one active ingester per (game, realm) at a
 * time. A fresh stream with no cursor/start id defaults to a recent window so the
 * CDN's no-id "first hour of history" crawl is never triggered.
 */
export async function ingestLiveStreams({ streams, config, now, makeRepo, makeProvider }) {
  const results = [];
  const seen = new Set();
  for (const stream of streams) {
    const key = `${stream.game}|${stream.realm}`;
    if (seen.has(key)) continue; // defense in depth; config already dedupes
    seen.add(key);
    const scope = { game: stream.game, realm: stream.realm, league: config.league, mode: "live" };
    const repo = makeRepo(scope);
    if (!repo) continue;
    const provider = makeProvider({ ...config, poeGame: stream.game, poeRealm: stream.realm });
    const cursor = (await repo.readCxapiState()).cursor;
    const startId =
      config.cxapiStartId ??
      (config.cxapiSource === "cdn" && cursor == null ? recentStartHour(now, config.cxapiMaxBackfillHours) : null);
    const catchingUp = cursor != null || startId != null;
    const summary = await ingestLive({
      repo,
      provider,
      league: null, // all public leagues
      startId,
      maxDigests: catchingUp ? Math.min(config.cxapiMaxBackfillHours, 12) : 1,
      // Game-scoped: only PoE2 has an identity map, so PoE1 streams pass through.
      translate: translatorForGame(stream.game),
    });
    results.push({ game: stream.game, realm: stream.realm, ...summary });
  }
  return results;
}
