/**
 * Serverless radar data access: per-request Postgres reads + a transactional
 * digest write. Unlike createSupabaseStorage (which hydrates in-memory ring
 * buffers at startup, built for the always-on server), this queries only the
 * bounded window it needs on each call, so it fits stateless Next.js Route
 * Handlers and the cron ingestion function.
 *
 * The `sql` client is injected (postgres.js tagged-template) so it can be mocked
 * in tests with no real database.
 */

const WINDOW_DAYS = 30;
// Per-pair cap on the radar read: the UI needs a 25-point sparkline and 24h
// metrics, so the latest ~48 completed hours per pair is ample. This bounds a
// read to ~(pairs × 48) rows instead of every candle in the 30-day window.
const MAX_HOURS_PER_PAIR = 48;
const OP_TIMEOUT_MS = 10_000;

/** Wall-clock guard so a stalled connection can't hang a serverless invocation. */
function withTimeout(promise, ms, label) {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

/** DB row -> candle object (mirrors createSupabaseStorage's hydration mapping). */
export function candleFromRow(r, { league } = {}) {
  return {
    league,
    completedHour: Number(r.completed_hour),
    digestId: Number(r.digest_id),
    pairId: r.pair_id,
    base: r.base_currency,
    quote: r.quote_currency,
    low: r.low_ratio == null ? null : Number(r.low_ratio),
    high: r.high_ratio == null ? null : Number(r.high_ratio),
    reference: r.reference_ratio == null ? null : Number(r.reference_ratio),
    referenceKind: r.reference_kind,
    volume: typeof r.volume === "string" ? JSON.parse(r.volume) : r.volume,
    stock: typeof r.stock === "string" ? JSON.parse(r.stock) : r.stock,
    source: r.source,
  };
}

/** Group flat candles into { [pairId]: candles[] } sorted by hour (radar input). */
export function groupCandlesByPair(candles) {
  const byPair = {};
  for (const candle of candles) {
    (byPair[candle.pairId] ??= []).push(candle);
  }
  for (const arr of Object.values(byPair)) arr.sort((a, b) => a.completedHour - b.completedHour);
  return byPair;
}

/**
 * @param {{
 *   sql: any,                              // postgres.js client (or a mock)
 *   scope: { game: string, realm: string, league: string, mode: string },
 *   windowDays?: number,
 *   opTimeoutMs?: number,
 * }} opts
 */
export function createRadarRepository({
  sql,
  scope,
  windowDays = WINDOW_DAYS,
  maxHoursPerPair = MAX_HOURS_PER_PAIR,
  opTimeoutMs = OP_TIMEOUT_MS,
}) {
  if (!sql) throw new Error("radar repository requires a postgres.js sql client");
  if (!scope) throw new Error("radar repository requires a scope { game, realm, league, mode }");

  /**
   * The latest `maxHoursPerPair` candles per pair within the window — the
   * radar/hotlist input. Capped per pair so a read stays bounded even with
   * hundreds of pairs over a 30-day retention.
   */
  async function readCandleWindow() {
    // Top `maxHoursPerPair` completed hours per pair. A window function
    // (row_number over partition by pair_id) forces Postgres to read EVERY
    // in-window row for every pair and sort them — tens of seconds once the
    // fixture catalog fills the 30-day retention (~500k rows). Instead we
    // enumerate the distinct pairs, then LATERAL-join the newest N rows of each
    // via an index range scan (see hourly_market_candles_pair_recent_idx:
    // scope + pair_id + completed_hour desc), so each pair reads only ~N rows.
    // No global ORDER BY: groupCandlesByPair re-sorts per pair downstream, so
    // the outer sort was pure overhead (a large on-disk sort).
    const rows = await withTimeout(
      sql`
        select c.completed_hour, c.digest_id, c.pair_id, c.base_currency, c.quote_currency,
               c.low_ratio, c.high_ratio, c.reference_ratio, c.reference_kind, c.volume, c.stock, c.source
        from (
          select distinct pair_id
          from hourly_market_candles
          where game = ${scope.game} and realm = ${scope.realm} and league = ${scope.league}
            and provider = ${scope.mode}
            and completed_hour >= now() - make_interval(days => ${windowDays})
        ) p
        cross join lateral (
          select extract(epoch from h.completed_hour) * 1000 as completed_hour,
                 h.digest_id, h.pair_id, h.base_currency, h.quote_currency, h.low_ratio,
                 h.high_ratio, h.reference_ratio, h.reference_kind, h.volume, h.stock, h.source
          from hourly_market_candles h
          where h.game = ${scope.game} and h.realm = ${scope.realm} and h.league = ${scope.league}
            and h.provider = ${scope.mode} and h.pair_id = p.pair_id
            and h.completed_hour >= now() - make_interval(days => ${windowDays})
          order by h.completed_hour desc
          limit ${maxHoursPerPair}
        ) c`,
      opTimeoutMs,
      "radar candle window",
    );
    return rows.map((r) => candleFromRow(r, { league: scope.league }));
  }

  /** Candles for a single pair (history chart). Bounded by the same window. */
  async function readPairCandles(pairId) {
    const rows = await withTimeout(
      sql`
        select extract(epoch from completed_hour) * 1000 as completed_hour,
               digest_id, pair_id, base_currency, quote_currency, low_ratio,
               high_ratio, reference_ratio, reference_kind, volume, stock, source
        from hourly_market_candles
        where game = ${scope.game} and realm = ${scope.realm} and league = ${scope.league}
          and provider = ${scope.mode} and pair_id = ${pairId}
          and completed_hour >= now() - make_interval(days => ${windowDays})
        order by completed_hour asc`,
      opTimeoutMs,
      "radar pair candles",
    );
    return rows.map((r) => candleFromRow(r, { league: scope.league }));
  }

  /** The cxapi ingestion cursor for this scope. */
  async function readCxapiState() {
    const rows = await withTimeout(
      sql`
        select next_change_id, last_digest_id from cxapi_state
        where game = ${scope.game} and realm = ${scope.realm} and provider = ${scope.mode}`,
      opTimeoutMs,
      "cxapi state",
    );
    const row = rows[0];
    return {
      cursor: row?.next_change_id == null ? null : Number(row.next_change_id),
      lastDigestId: row?.last_digest_id == null ? null : Number(row.last_digest_id),
    };
  }

  /**
   * Persist one normalized digest and advance the cursor in ONE transaction, so
   * the cursor can never move ahead of the candles it represents. Idempotent:
   * duplicate candles are dropped by the primary key. Returns the count of
   * newly-inserted candles.
   */
  async function recordCxDigest(digest) {
    return withTimeout(
      sql.begin(async (tx) => {
        let inserted = 0;
        if (digest.candles?.length) {
          const rows = digest.candles.map((c) => ({
            game: scope.game,
            realm: scope.realm,
            // One stream carries every league, so each candle stores its OWN
            // league (falling back to the scope league for legacy callers).
            league: c.league ?? scope.league,
            provider: scope.mode,
            completed_hour: new Date(c.completedHour),
            digest_id: String(c.digestId),
            pair_id: c.pairId,
            base_currency: c.base,
            quote_currency: c.quote,
            low_ratio: c.low,
            high_ratio: c.high,
            reference_ratio: c.reference,
            reference_kind: c.referenceKind,
            volume: JSON.stringify(c.volume),
            stock: JSON.stringify(c.stock),
            source: c.source,
          }));
          const result = await tx`insert into hourly_market_candles ${tx(rows)} on conflict do nothing`;
          inserted = result.count ?? 0;
        }
        // Monotonic cursor: never let a late/overlapping invocation move the
        // cursor backward (e.g. an older digest committing after a newer one).
        // Only advance when the incoming digest id is non-null and not older
        // than what's stored. This — together with on-conflict-do-nothing on the
        // candles — makes concurrent ingest runs safe WITHOUT a distributed lock
        // (which also avoids unreliable session advisory locks under the pooler).
        // Keyed per (game, realm, provider): one CDN stream feeds every league,
        // so the cursor is league-independent (see migration 006).
        await tx`
          insert into cxapi_state (game, realm, provider, next_change_id, last_digest_id, updated_at)
          values (${scope.game}, ${scope.realm}, ${scope.mode},
                  ${digest.nextChangeId ?? null}, ${digest.digestId ?? null}, now())
          on conflict (game, realm, provider) do update set
            next_change_id = excluded.next_change_id,
            last_digest_id = excluded.last_digest_id,
            updated_at = excluded.updated_at
          where excluded.last_digest_id is not null
            and (cxapi_state.last_digest_id is null
                 or excluded.last_digest_id >= cxapi_state.last_digest_id)`;
        return inserted;
      }),
      opTimeoutMs,
      "recordCxDigest",
    );
  }

  return { readCandleWindow, readPairCandles, readCxapiState, recordCxDigest };
}
