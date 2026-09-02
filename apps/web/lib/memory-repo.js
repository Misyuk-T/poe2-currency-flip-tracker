/**
 * In-memory radar repository: the same read/write surface as
 * createRadarRepository (readCandleWindow / readPairCandles / readCxapiState /
 * recordCxDigest), backed by a plain Map instead of Postgres.
 *
 * Used ONLY as an offline fixture fallback for local dev when DATABASE_URL is
 * absent (see radar-backend.js). It restores the old always-on server's
 * "offline, safe" behaviour — a full synthetic radar with no database — without
 * resurrecting that server. Never used in production when a database is present.
 */

import { isPublicLeague } from "../../../src/domain/cx-market.js";
import { isPermanentLeague } from "../../../src/domain/league-default.js";

const WINDOW_DAYS = 30;
const MAX_HOURS_PER_PAIR = 48;
const DAY_MS = 86_400_000;

export function createMemoryRepository(scope, { windowDays = WINDOW_DAYS, maxHoursPerPair = MAX_HOURS_PER_PAIR } = {}) {
  if (!scope) throw new Error("memory repository requires a scope { game, realm, league, mode }");

  // Dedupe candles by their primary key (completedHour|pairId) so re-running the
  // fixture ingest is idempotent, mirroring `on conflict do nothing`.
  const byKey = new Map();
  // league -> league_meta row. Upsert-only, exactly like the SQL table.
  const leagueMeta = new Map();
  let cursor = null;
  let lastDigestId = null;

  const windowStart = (now) => now - windowDays * DAY_MS;

  async function recordCxDigest(digest) {
    let inserted = 0;
    for (const c of digest.candles ?? []) {
      const league = c.league ?? scope.league;
      // Key includes league, mirroring the SQL primary key: one stream carries
      // many leagues, so the same pair/hour recurs per league without colliding.
      const key = `${league}|${c.completedHour}|${c.pairId}`;
      if (byKey.has(key)) continue;
      byKey.set(key, { ...c, league });
      inserted += 1;
    }
    // Monotonic cursor, matching createRadarRepository.recordCxDigest.
    if (digest.digestId != null && (lastDigestId == null || digest.digestId >= lastDigestId)) {
      lastDigestId = digest.digestId;
      cursor = digest.nextChangeId ?? cursor;
    }
    return inserted;
  }

  async function readCandleWindow(now = Date.now()) {
    const start = windowStart(now);
    const byPair = new Map();
    for (const c of byKey.values()) {
      if (c.completedHour < start) continue;
      let arr = byPair.get(c.pairId);
      if (!arr) byPair.set(c.pairId, (arr = []));
      arr.push(c);
    }
    const out = [];
    for (const arr of byPair.values()) {
      arr.sort((a, b) => a.completedHour - b.completedHour);
      // Latest `maxHoursPerPair` per pair, matching the SQL window read.
      out.push(...arr.slice(-maxHoursPerPair));
    }
    return out.sort((a, b) => a.completedHour - b.completedHour);
  }

  async function readPairCandles(pairId, now = Date.now()) {
    const start = windowStart(now);
    return [...byKey.values()]
      .filter((c) => c.pairId === pairId && c.completedHour >= start)
      .sort((a, b) => a.completedHour - b.completedHour);
  }

  async function readCxapiState() {
    return { cursor, lastDigestId };
  }

  /**
   * NOTE: the three league-meta methods below are exercised by tests only. The
   * cron's refreshLeagueDefaults builds its repository with `repository()`
   * (Postgres or nothing), not with `resolveRepo()`, so the offline fixture
   * fallback never reaches them — with no database it reports a skip instead.
   * They exist so the orchestration can be tested without a Postgres, and they
   * mirror the SQL semantics exactly for that reason.
   *
   * The in-memory twin of createRadarRepository.refreshLeagueMeta: the same
   * per-league aggregate (first/last hour, distinct pairs, distinct completed
   * hours) over the same window, with the same least()/greatest() merge on the
   * seen-at bounds so first_seen_at only ever moves backwards in time.
   */
  async function refreshLeagueMeta({ now = Date.now() } = {}) {
    const at = now instanceof Date ? now.getTime() : Number(now);
    const start = windowStart(at);
    const byLeague = new Map();
    for (const candle of byKey.values()) {
      if (candle.completedHour < start) continue;
      const league = candle.league ?? scope.league;
      let entry = byLeague.get(league);
      if (!entry) byLeague.set(league, (entry = { pairs: new Set(), hours: new Set(), first: null, last: null }));
      entry.pairs.add(candle.pairId);
      entry.hours.add(candle.completedHour);
      entry.first = entry.first == null ? candle.completedHour : Math.min(entry.first, candle.completedHour);
      entry.last = entry.last == null ? candle.completedHour : Math.max(entry.last, candle.completedHour);
    }
    for (const [league, entry] of byLeague) {
      const previous = leagueMeta.get(league);
      leagueMeta.set(league, {
        game: scope.game,
        realm: scope.realm,
        provider: scope.mode,
        league,
        firstSeenAt: previous?.firstSeenAt == null ? entry.first : Math.min(previous.firstSeenAt, entry.first),
        lastSeenAt: previous?.lastSeenAt == null ? entry.last : Math.max(previous.lastSeenAt, entry.last),
        pairCount: entry.pairs.size,
        completedHours: entry.hours.size,
        isPublic: isPublicLeague(league),
        isPermanent: isPermanentLeague(league, scope.game),
        isDefault: previous?.isDefault === true,
      });
    }
    return readLeagueMeta();
  }

  async function readLeagueMeta(game = scope.game, realm = scope.realm, provider = scope.mode) {
    return [...leagueMeta.values()]
      .filter((row) => row.game === game && row.realm === realm && row.provider === provider)
      .map((row) => ({ ...row }))
      .sort((a, b) => (b.firstSeenAt ?? -Infinity) - (a.firstSeenAt ?? -Infinity) || a.league.localeCompare(b.league));
  }

  async function setDefaultLeague(league) {
    if (typeof league !== "string" || !league) return false;
    if (!leagueMeta.has(league)) {
      leagueMeta.set(league, {
        game: scope.game,
        realm: scope.realm,
        provider: scope.mode,
        league,
        firstSeenAt: null,
        lastSeenAt: null,
        pairCount: 0,
        completedHours: 0,
        isPublic: isPublicLeague(league),
        isPermanent: isPermanentLeague(league, scope.game),
        isDefault: false,
      });
    }
    for (const [name, row] of leagueMeta) row.isDefault = name === league;
    return true;
  }

  return {
    readCandleWindow,
    readPairCandles,
    readCxapiState,
    recordCxDigest,
    refreshLeagueMeta,
    readLeagueMeta,
    setDefaultLeague,
  };
}
