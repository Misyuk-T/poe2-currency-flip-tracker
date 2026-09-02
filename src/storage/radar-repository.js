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

import { canonicalizeCandle, isPublicLeague } from "../domain/cx-market.js";
import { isPermanentLeague } from "../domain/league-default.js";

const WINDOW_DAYS = 7;
// How far back the RADAR read looks. The Free-plan store retains seven days;
// the radar itself only needs the latest 24 hours plus one boundary sample.
//
// The per-pair cap below means the read never consumes more than 25 hours of any
// one pair, but the query still had to enumerate every pair in the read window
// to find them. On the busiest league that scan crossed the statement
// timeout, and the hourly snapshot rebuild failed with it every single hour —
// silently, because the caller degrades instead of erroring. Every smaller
// league rebuilt fine, so the failure looked like a data problem rather than a
// query that had simply outgrown its window.
//
// The trade-off, stated plainly: a market whose last trade is older than this
// drops out of the tracked rows and appears as "no trades this hour" instead of
// showing a week-old price. It was already flagged stale; now it is absent.
const READ_WINDOW_DAYS = 7;
// Per-pair cap on the radar read: the UI needs a 25-point sparkline and 24h
// metrics, so the latest 25 completed hours per pair is the complete input. This
// bounds a read to ~(pairs × 25) rows instead of every candle in the window.
const MAX_HOURS_PER_PAIR = 25;
// Outer guard in a deliberate cascade, each layer wider than the one inside it:
//   Postgres statement_timeout (15s, apps/web/lib/db.js)
//     -> this app-level guard (18s)
//       -> the route's maxDuration (30s)
// So a slow query is cancelled by Postgres with a real error, and this only
// fires when the connection went silent entirely. It previously sat BELOW the
// statement timeout, which made the database-side limit unreachable.
const OP_TIMEOUT_MS = 18_000;

/** Wall-clock guard so a stalled connection can't hang a serverless invocation. */
function withTimeout(promise, ms, label, onTimeout = null) {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try {
        Promise.resolve(onTimeout?.({ label, ms })).catch(() => {});
      } finally {
        reject(new Error(`${label} timed out after ${ms}ms`));
      }
    }, ms);
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

const noop = () => {};

function errorDetails(error) {
  return {
    errorName: error?.name ?? "Error",
    errorCode: error?.code ?? null,
    errorMessage: error?.message ?? String(error),
  };
}

function jsonValue(value) {
  return typeof value === "string" ? JSON.parse(value) : value;
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

/** Group flat candles into { [pairId]: candles[] } sorted by hour (radar input).
 *  Pass `canonicalId` to fold history stored under a superseded currency id into
 *  the market it actually belongs to (see canonicalizeCandle). */
export function groupCandlesByPair(candles, { canonicalId } = {}) {
  const byPair = {};
  for (const stored of candles) {
    const candle = canonicalizeCandle(stored, canonicalId);
    (byPair[candle.pairId] ??= []).push(candle);
  }
  for (const arr of Object.values(byPair)) arr.sort((a, b) => a.completedHour - b.completedHour);
  return byPair;
}

/**
 * @param {{
 *   sql: any,                              // postgres.js client (or a mock)
 *   scope: { game: string, realm: string, league: string, mode: string },
 *   windowDays?: number,                   // retention window for per-pair history
 *   readWindowDays?: number,               // how far back the radar read looks
 *   anchors?: string[],                     // currencies the radar can price against
 *   opTimeoutMs?: number,
 * }} opts
 */
export function createRadarRepository({
  sql,
  scope,
  windowDays = WINDOW_DAYS,
  readWindowDays = READ_WINDOW_DAYS,
  maxHoursPerPair = MAX_HOURS_PER_PAIR,
  anchors = [],
  opTimeoutMs = OP_TIMEOUT_MS,
  onPhase = noop,
  onTimeout = null,
}) {
  if (!sql) throw new Error("radar repository requires a postgres.js sql client");
  if (!scope) throw new Error("radar repository requires a scope { game, realm, league, mode }");

  /**
   * The latest `maxHoursPerPair` candles per pair within the window — the
   * radar/hotlist input. Capped per pair so a read stays bounded even with
   * hundreds of pairs over the retention window.
   */
  async function readCandleWindow() {
    // Top `maxHoursPerPair` completed hours per pair. A window function
    // (row_number over partition by pair_id) forces Postgres to read EVERY
    // in-window row for every pair and sort them — tens of seconds once the
    // fixture catalog fills a long retention window (~500k rows). Instead we
    // enumerate the distinct pairs, then LATERAL-join the newest N rows of each
    // via an index range scan on the primary key (scope + pair_id +
    // completed_hour; Postgres scans the final key backwards), so each pair
    // reads only ~N rows.
    // No global ORDER BY: groupCandlesByPair re-sorts per pair downstream, so
    // the outer sort was pure overhead (a large on-disk sort).
    const rows = await withTimeout(
      sql`
        select c.completed_hour, c.pair_id, c.base_currency, c.quote_currency,
               c.low_ratio, c.high_ratio, c.volume
        from (
          select distinct pair_id
          from hourly_market_candles
          where game = ${scope.game} and realm = ${scope.realm} and league = ${scope.league}
            and provider = ${scope.mode}
            and (${anchors.length} = 0
              or base_currency = any(${anchors}::text[])
              or quote_currency = any(${anchors}::text[]))
            and completed_hour >= now() - make_interval(days => ${readWindowDays})
        ) p
        cross join lateral (
          select extract(epoch from h.completed_hour) * 1000 as completed_hour,
                 h.pair_id, h.base_currency, h.quote_currency, h.low_ratio,
                 h.high_ratio, h.volume
          from hourly_market_candles h
          where h.game = ${scope.game} and h.realm = ${scope.realm} and h.league = ${scope.league}
            and h.provider = ${scope.mode} and h.pair_id = p.pair_id
            and (${anchors.length} = 0
              or h.base_currency = any(${anchors}::text[])
              or h.quote_currency = any(${anchors}::text[]))
            and h.completed_hour >= now() - make_interval(days => ${readWindowDays})
          order by h.completed_hour desc
          limit ${maxHoursPerPair}
        ) c`,
      opTimeoutMs,
      "radar candle window",
      onTimeout,
    );
    return rows.map((r) => candleFromRow(r, { league: scope.league }));
  }

  /** Candles for a single pair (history chart). Bounded by the same window. */
  async function readPairCandles(pairId) {
    const rows = await withTimeout(
      sql`
        select extract(epoch from completed_hour) * 1000 as completed_hour,
               pair_id, base_currency, quote_currency, low_ratio,
               high_ratio, reference_ratio, reference_kind, volume
        from hourly_market_candles
        where game = ${scope.game} and realm = ${scope.realm} and league = ${scope.league}
          and provider = ${scope.mode} and pair_id = ${pairId}
          and completed_hour >= now() - make_interval(days => ${windowDays})
        order by completed_hour asc`,
      opTimeoutMs,
      "radar pair candles",
      onTimeout,
    );
    return rows.map((r) => candleFromRow(r, { league: scope.league }));
  }

  /**
   * Lightweight league-availability probe for /api/config. It deliberately
   * stops at the first priced candle instead of building the full radar.
   */
  async function hasPricedCandles() {
    const rows = await withTimeout(
      sql`
        select exists (
          select 1
          from hourly_market_candles
          where game = ${scope.game} and realm = ${scope.realm} and league = ${scope.league}
            and provider = ${scope.mode}
            and completed_hour >= now() - make_interval(days => ${windowDays})
            and reference_ratio is not null and reference_ratio > 0
          limit 1
        ) as available`,
      opTimeoutMs,
      "league availability",
      onTimeout,
    );
    return rows[0]?.available === true;
  }

  /** Recent public league scopes that contain at least one priced candle. */
  async function listPricedLeagues() {
    const rows = await withTimeout(
      sql`
        select league, extract(epoch from max(completed_hour)) * 1000 as newest_completed_hour
        from hourly_market_candles
        where game = ${scope.game} and realm = ${scope.realm} and provider = ${scope.mode}
          and completed_hour >= now() - make_interval(days => ${windowDays})
          and reference_ratio is not null and reference_ratio > 0
        group by league
        order by max(completed_hour) desc, league asc
        limit 64`,
      opTimeoutMs,
      "priced league discovery",
      onTimeout,
    );
    return rows
      .filter((row) => typeof row.league === "string" && row.league.length > 0)
      .map((row) => ({ league: row.league, newestCompletedHour: Number(row.newest_completed_hour) || null }));
  }

  /**
   * Recompute `league_meta` for this whole stream in ONE bounded aggregate.
   *
   * The query groups the candle window by league and asks four questions per
   * league: earliest hour, latest hour, distinct pairs, distinct completed
   * hours. It filters on (game, realm, provider) and selects only league,
   * pair_id and completed_hour, so every column it touches lives in the table's
   * PRIMARY KEY index (game, realm, league, provider, pair_id, completed_hour):
   * an index-only scan over the (game, realm) prefix, already ordered by league,
   * feeds a GroupAggregate with no extra sort and no heap access. That matters
   * because the dedicated pair_recent index was dropped for storage reasons
   * (migration 20260801132323) — the primary key is what is left, and it fits.
   *
   * Writes are upserts; rows are never deleted. `first_seen_at` is written with
   * least(existing, new) so seven-day retention pruning can never make an old
   * league look newly born — which would corrupt the forward-only hysteresis in
   * chooseDefaultLeague. `pair_count`/`completed_hours` are replaced, not
   * accumulated: they describe depth in the CURRENT window, which is what the
   * threshold asks about. `is_default` is deliberately untouched here; only
   * setDefaultLeague moves it.
   */
  async function refreshLeagueMeta({ now = new Date() } = {}) {
    const rows = await withTimeout(
      sql`
        select league,
               extract(epoch from min(completed_hour)) * 1000 as first_seen_at,
               extract(epoch from max(completed_hour)) * 1000 as last_seen_at,
               count(distinct pair_id) as pair_count,
               count(distinct completed_hour) as completed_hours
        from hourly_market_candles
        where game = ${scope.game} and realm = ${scope.realm} and provider = ${scope.mode}
          and completed_hour >= now() - make_interval(days => ${windowDays})
        group by league`,
      opTimeoutMs,
      "league meta aggregate",
      onTimeout,
    );
    const observed = rows
      .filter((row) => typeof row.league === "string" && row.league.length > 0)
      .map((row) => ({
        league: row.league,
        firstSeenAt: Number(row.first_seen_at) || null,
        lastSeenAt: Number(row.last_seen_at) || null,
        pairCount: Number(row.pair_count) || 0,
        completedHours: Number(row.completed_hours) || 0,
        isPublic: isPublicLeague(row.league),
        isPermanent: isPermanentLeague(row.league, scope.game),
      }));
    if (!observed.length) return readLeagueMeta();
    onPhase("db.leagueMeta.upsert.start", { leagues: observed.length });
    const updatedAt = now instanceof Date ? now : new Date(now);
    for (const row of observed) {
      await withTimeout(
        sql`
          insert into league_meta (
            game, realm, provider, league,
            first_seen_at, last_seen_at, pair_count, completed_hours,
            is_public, is_permanent, updated_at
          ) values (
            ${scope.game}, ${scope.realm}, ${scope.mode}, ${row.league},
            ${row.firstSeenAt == null ? null : new Date(row.firstSeenAt)},
            ${row.lastSeenAt == null ? null : new Date(row.lastSeenAt)},
            ${row.pairCount}, ${row.completedHours},
            ${row.isPublic}, ${row.isPermanent}, ${updatedAt}
          )
          on conflict (game, realm, provider, league) do update set
            first_seen_at = least(league_meta.first_seen_at, excluded.first_seen_at),
            last_seen_at = greatest(league_meta.last_seen_at, excluded.last_seen_at),
            pair_count = excluded.pair_count,
            completed_hours = excluded.completed_hours,
            is_public = excluded.is_public,
            is_permanent = excluded.is_permanent,
            updated_at = excluded.updated_at`,
        opTimeoutMs,
        "league meta upsert",
        onTimeout,
      );
    }
    onPhase("db.leagueMeta.upsert.end", { leagues: observed.length });
    return readLeagueMeta();
  }

  /** Stored league metadata for one stream. Newest first-seen first. */
  async function readLeagueMeta(
    game = scope.game,
    realm = scope.realm,
    provider = scope.mode,
  ) {
    const rows = await withTimeout(
      sql`
        select league,
               extract(epoch from first_seen_at) * 1000 as first_seen_at,
               extract(epoch from last_seen_at) * 1000 as last_seen_at,
               pair_count, completed_hours, is_public, is_permanent, is_default
        from league_meta
        where game = ${game} and realm = ${realm} and provider = ${provider}
        order by first_seen_at desc nulls last, league asc`,
      opTimeoutMs,
      "league meta read",
      onTimeout,
    );
    return rows.map((row) => ({
      game,
      realm,
      provider,
      league: row.league,
      firstSeenAt: row.first_seen_at == null ? null : Number(row.first_seen_at),
      lastSeenAt: row.last_seen_at == null ? null : Number(row.last_seen_at),
      pairCount: Number(row.pair_count) || 0,
      completedHours: Number(row.completed_hours) || 0,
      isPublic: row.is_public !== false,
      isPermanent: row.is_permanent === true,
      isDefault: row.is_default === true,
    }));
  }

  /**
   * Point `is_default` at one league, atomically. The chosen league is upserted
   * (it may have no candles yet — an env/code fallback still deserves a row) and
   * every other league in the same stream is cleared in the SAME transaction, so
   * a reader can never observe zero or two defaults.
   */
  async function setDefaultLeague(
    league,
    { game = scope.game, realm = scope.realm, provider = scope.mode } = {},
  ) {
    if (typeof league !== "string" || !league) return false;
    onPhase("db.leagueMeta.default.start", { league });
    await withTimeout(
      sql.begin(async (tx) => {
        await tx`
          insert into league_meta (game, realm, provider, league, is_public, is_permanent, is_default, updated_at)
          values (${game}, ${realm}, ${provider}, ${league},
                  ${isPublicLeague(league)}, ${isPermanentLeague(league, game)}, true, now())
          on conflict (game, realm, provider, league) do update set
            is_default = true, updated_at = now()`;
        await tx`
          update league_meta set is_default = false, updated_at = now()
          where game = ${game} and realm = ${realm} and provider = ${provider}
            and league <> ${league} and is_default`;
      }),
      opTimeoutMs,
      "league meta default",
      onTimeout,
    );
    onPhase("db.leagueMeta.default.end", { league });
    return true;
  }

  /**
   * Currencies ranked by how many distinct priced pairs they connect in this
   * league. This is the data-driven anchor selector: Standard usually resolves
   * to Chaos/Divine, while Ruthless naturally resolves to Orb of Alchemy.
   */
  async function listAnchorCandidates(limit = 12) {
    const rows = await withTimeout(
      sql`
        with priced_pairs as (
          select pair_id, base_currency, quote_currency, count(*) as sample_count
          from hourly_market_candles
          where game = ${scope.game} and realm = ${scope.realm} and league = ${scope.league}
            and provider = ${scope.mode}
            and completed_hour >= now() - make_interval(days => ${readWindowDays})
            and low_ratio is not null and low_ratio > 0
            and high_ratio is not null and high_ratio > 0
          group by pair_id, base_currency, quote_currency
        ), currency_edges as (
          select base_currency as currency, pair_id, sample_count from priced_pairs
          union all
          select quote_currency as currency, pair_id, sample_count from priced_pairs
        )
        select currency, count(distinct pair_id) as pair_count, sum(sample_count) as sample_count
        from currency_edges
        group by currency
        order by count(distinct pair_id) desc, sum(sample_count) desc, currency asc
        limit ${Math.max(1, Math.min(Number(limit) || 12, 64))}`,
      opTimeoutMs,
      "anchor discovery",
      onTimeout,
    );
    return rows
      .filter((row) => typeof row.currency === "string" && row.currency.length > 0)
      .map((row) => ({
        currency: row.currency,
        pairCount: Number(row.pair_count) || 0,
        sampleCount: Number(row.sample_count) || 0,
      }));
  }

  /** Latest precomputed /api/radar response for one anchor, if present. */
  async function readRadarSnapshot(anchor) {
    const rows = await withTimeout(
      sql`
        select payload, extract(epoch from refreshed_at) * 1000 as refreshed_at
        from radar_snapshots
        where game = ${scope.game} and realm = ${scope.realm} and league = ${scope.league}
          and provider = ${scope.mode} and anchor = ${anchor}
        limit 1`,
      opTimeoutMs,
      "radar snapshot read",
      onTimeout,
    );
    const row = rows[0];
    if (!row) return null;
    return {
      payload: jsonValue(row.payload),
      refreshedAt: Number(row.refreshed_at),
    };
  }

  /**
   * Replace one or more anchor responses for this scope. Each anchor upsert is
   * atomic, and the primary key makes overlapping cron/on-demand refreshes
   * idempotent.
   */
  async function writeRadarSnapshots(snapshots) {
    const values = (snapshots ?? []).filter((snapshot) => snapshot?.anchor && snapshot?.payload);
    if (!values.length) return 0;
    const rows = values.map(({ anchor, payload }) => {
      const latestCompletedHour = (payload.rows ?? []).reduce(
        (latest, row) => Math.max(latest, Number(row.latestCompletedHour) || 0),
        0,
      );
      return {
        game: scope.game,
        realm: scope.realm,
        league: scope.league,
        provider: scope.mode,
        anchor,
        latest_completed_hour: latestCompletedHour ? new Date(latestCompletedHour) : null,
        generated_at: new Date(payload.generatedAt),
        refreshed_at: new Date(),
        payload,
      };
    });
    onPhase("db.snapshots.upsert.start", { league: scope.league, snapshots: rows.length });
    let written = 0;
    for (const row of rows) {
      const result = await withTimeout(
        sql`
          insert into radar_snapshots (
            game, realm, league, provider, anchor,
            latest_completed_hour, generated_at, refreshed_at, payload
          ) values (
            ${row.game}, ${row.realm}, ${row.league}, ${row.provider}, ${row.anchor},
            ${row.latest_completed_hour}, ${row.generated_at}, ${row.refreshed_at},
            ${sql.json(row.payload)}
          )
          on conflict (game, realm, league, provider, anchor) do update set
            latest_completed_hour = excluded.latest_completed_hour,
            generated_at = excluded.generated_at,
            refreshed_at = excluded.refreshed_at,
            payload = excluded.payload`,
        opTimeoutMs,
        "radar snapshot upsert",
        onTimeout,
      );
      written += result.count ?? 1;
    }
    onPhase("db.snapshots.upsert.end", { league: scope.league, snapshots: rows.length });
    return written;
  }

  /** The cxapi ingestion cursor for this scope. */
  async function readCxapiState() {
    const rows = await withTimeout(
      sql`
        select next_change_id, last_digest_id from cxapi_state
        where game = ${scope.game} and realm = ${scope.realm} and provider = ${scope.mode}`,
      opTimeoutMs,
      "cxapi state",
      onTimeout,
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
    const candles = digest.candles?.length ?? 0;
    onPhase("db.transaction.start", { digestId: digest.digestId ?? null, candles });
    try {
      const inserted = await withTimeout(
        sql.begin(async (tx) => {
          onPhase("db.transaction.acquired", { digestId: digest.digestId ?? null });
          // Bound each statement server-side and don't wait forever on a lock —
          // belt-and-suspenders in case the Supavisor pooler doesn't preserve the
          // startup statement_timeout on a fresh transaction connection.
          onPhase("db.transaction.timeouts.start", { digestId: digest.digestId ?? null });
          await tx`set local statement_timeout = '8000ms'`;
          await tx`set local lock_timeout = '3000ms'`;
          onPhase("db.transaction.timeouts.end", { digestId: digest.digestId ?? null });
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
              // Stock ranges are not consumed by the radar, history chart, or
              // plan model. Keeping the JSON for every pair/hour added hundreds
              // of MB to the Free-plan database, so new rows store the schema's
              // neutral empty value.
              stock: {},
              source: c.source,
            }));
            // Batch the insert. One ~2000-row unnamed (prepare:false) insert is a
            // huge extended-protocol message that can stall at the pooler boundary
            // (statement_timeout doesn't cover that wait) and hang the sole max:1
            // connection. Small chunks keep each statement light and quick.
            const CHUNK = 250;
            for (let i = 0; i < rows.length; i += CHUNK) {
              const batch = Math.floor(i / CHUNK) + 1;
              const batchRows = rows.slice(i, i + CHUNK);
              onPhase("db.candles.batch.start", { digestId: digest.digestId ?? null, batch, rows: batchRows.length });
              const result = await tx`insert into hourly_market_candles ${tx(batchRows)} on conflict do nothing`;
              inserted += result.count ?? 0;
              onPhase("db.candles.batch.end", { digestId: digest.digestId ?? null, batch, inserted: result.count ?? 0 });
            }

            // A cached snapshot for an inactive/alternate league is otherwise
            // allowed to live for hours after fresh candles arrive. Invalidate
            // only the leagues carried by this digest; their next API request
            // will rebuild the snapshot from the newly committed data.
            const touchedLeagues = [...new Set(rows.map((row) => row.league))];
            onPhase("db.snapshots.invalidate.start", {
              digestId: digest.digestId ?? null,
              leagues: touchedLeagues.length,
            });
            await tx`
              delete from radar_snapshots
              where game = ${scope.game}
                and realm = ${scope.realm}
                and provider = ${scope.mode}
                and league in ${tx(touchedLeagues)}`;
            onPhase("db.snapshots.invalidate.end", {
              digestId: digest.digestId ?? null,
              leagues: touchedLeagues.length,
            });
          }
          // Monotonic cursor: never let a late/overlapping invocation move the
          // cursor backward (e.g. an older digest committing after a newer one).
          // Only advance when the incoming digest id is non-null and not older
          // than what's stored. This — together with on-conflict-do-nothing on the
          // candles — makes concurrent ingest runs safe WITHOUT a distributed lock
          // (which also avoids unreliable session advisory locks under the pooler).
          // Keyed per (game, realm, provider): one CDN stream feeds every league,
          // so the cursor is league-independent (see migration 006).
          onPhase("db.cursor.upsert.start", { digestId: digest.digestId ?? null });
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
          onPhase("db.cursor.upsert.end", { digestId: digest.digestId ?? null });
          return inserted;
        }),
        opTimeoutMs,
        "recordCxDigest",
        onTimeout,
      );
      onPhase("db.transaction.end", { digestId: digest.digestId ?? null, inserted });
      return inserted;
    } catch (error) {
      onPhase("db.transaction.error", { digestId: digest.digestId ?? null, ...errorDetails(error) });
      throw error;
    }
  }

  return {
    readCandleWindow,
    readPairCandles,
    hasPricedCandles,
    listPricedLeagues,
    refreshLeagueMeta,
    readLeagueMeta,
    setDefaultLeague,
    listAnchorCandidates,
    readRadarSnapshot,
    writeRadarSnapshots,
    readCxapiState,
    recordCxDigest,
  };
}
