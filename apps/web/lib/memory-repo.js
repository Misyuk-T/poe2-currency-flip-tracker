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

const WINDOW_DAYS = 30;
const MAX_HOURS_PER_PAIR = 48;
const DAY_MS = 86_400_000;

export function createMemoryRepository(scope, { windowDays = WINDOW_DAYS, maxHoursPerPair = MAX_HOURS_PER_PAIR } = {}) {
  if (!scope) throw new Error("memory repository requires a scope { game, realm, league, mode }");

  // Dedupe candles by their primary key (completedHour|pairId) so re-running the
  // fixture ingest is idempotent, mirroring `on conflict do nothing`.
  const byKey = new Map();
  let cursor = null;
  let lastDigestId = null;

  const windowStart = (now) => now - windowDays * DAY_MS;

  async function recordCxDigest(digest) {
    let inserted = 0;
    for (const c of digest.candles ?? []) {
      const key = `${c.completedHour}|${c.pairId}`;
      if (byKey.has(key)) continue;
      byKey.set(key, { ...c, league: scope.league });
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

  return { readCandleWindow, readPairCandles, readCxapiState, recordCxDigest };
}
