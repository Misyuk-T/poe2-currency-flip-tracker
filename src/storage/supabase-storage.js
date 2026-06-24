/**
 * Supabase StorageProvider: in-memory read buffers + durable Postgres.
 *
 * - postgres.js is loaded ONLY here, lazily, so local/test paths stay zero-dep.
 *   Enable with STORAGE=supabase + DATABASE_URL, and `npm install postgres`.
 * - Tables snapshot_runs / market_points are written by a trusted server role;
 *   the connection string (NOT a service_role JWT, NOT exposed to the browser)
 *   is the credential. `provider` column = scope.mode, so fixture and live data
 *   never mix in the DB either.
 * - Durable writes are BEST-EFFORT: the in-memory buffer is updated first, and
 *   every DB op is BOTH server-bounded (statement_timeout) and wall-bounded
 *   (withTimeout), and errors are logged, never thrown — so a Supabase outage or
 *   stall can neither fail a refresh nor block polling.
 */

import { createHistoryStore } from "../server/history-store.js";
import { createHourlyStore } from "./hourly-store.js";

const EMPTY_SERIES = { all: () => ({}), get: () => [] };
const PER_TARGET_LIMIT = 600; // points loaded per target at startup
const OP_TIMEOUT_MS = 10_000;

async function defaultConnect(url) {
  let postgres;
  try {
    ({ default: postgres } = await import("postgres"));
  } catch {
    throw new Error('STORAGE=supabase requires the "postgres" package — run `npm install postgres`.');
  }
  return postgres(url, {
    prepare: false, // Supavisor transaction pooling
    ssl: "require",
    max: 4,
    connect_timeout: 10,
    idle_timeout: 20,
    connection: { statement_timeout: 8000 }, // server-side cap on any single query (ms)
  });
}

function withTimeout(promise, ms, label) {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

/**
 * @param {import("../server/config.js").AppConfig} config
 * @param {{ connect?: (url: string) => Promise<any> }} [opts]  inject a connector for tests
 */
export function createSupabaseStorage(config, { connect = defaultConnect } = {}) {
  /** @type {Map<string, ReturnType<typeof createHistoryStore>>} */
  const stores = new Map();
  let scope = null;
  let sql = null;
  const hourlyStore = createHourlyStore();

  function point(r) {
    return {
      t: Number(r.t),
      target: r.target,
      bestEntry: r.best_entry,
      bestExit: r.best_exit,
      spreadPct: r.spread_pct,
      depthEntry: r.depth_entry,
      depthExit: r.depth_exit,
      mode: scope.mode,
      synthetic: r.synthetic || undefined,
    };
  }

  return {
    mode: "supabase",

    async init(s, anchors) {
      scope = s;
      sql = await connect(config.databaseUrl);

      for (const anchor of anchors) {
        const store = createHistoryStore({ scope: { ...scope, anchor } }); // in-memory only
        try {
          // Up to PER_TARGET_LIMIT points PER TARGET (window), not total.
          const rows = await withTimeout(
            sql`
              select target, t, best_entry, best_exit, spread_pct, depth_entry, depth_exit, synthetic
              from (
                select target,
                       extract(epoch from observed_at) * 1000 as t,
                       best_entry, best_exit, spread_pct, depth_entry, depth_exit, synthetic,
                       row_number() over (partition by target order by observed_at desc) as rn
                from market_points
                where game = ${scope.game} and realm = ${scope.realm} and league = ${scope.league}
                  and anchor = ${anchor} and provider = ${scope.mode}
              ) q
              where rn <= ${PER_TARGET_LIMIT}
              order by t asc`,
            OP_TIMEOUT_MS,
            "history load",
          );
          store.seed(rows.map(point));
        } catch (err) {
          process.stderr.write(`[poe2-flip] storage load failed (${anchor}): ${err.message}\n`);
        }
        stores.set(anchor, store);
      }
      try {
        const [candles, states] = await Promise.all([
          withTimeout(sql`
            select extract(epoch from completed_hour) * 1000 as completed_hour,
                   digest_id, pair_id, base_currency, quote_currency, low_ratio,
                   high_ratio, reference_ratio, reference_kind, volume, stock, source
            from hourly_market_candles
            where game = ${scope.game} and realm = ${scope.realm} and league = ${scope.league}
              and provider = ${scope.mode} and completed_hour >= now() - interval '30 days'
            order by completed_hour asc`, OP_TIMEOUT_MS, "hourly history load"),
          withTimeout(sql`
            select next_change_id, last_digest_id from cxapi_state
            where game = ${scope.game} and realm = ${scope.realm} and league = ${scope.league}
              and provider = ${scope.mode}`, OP_TIMEOUT_MS, "cxapi state load"),
        ]);
        hourlyStore.seed(candles.map((r) => ({
          league: scope.league,
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
        })), {
          cursor: states[0]?.next_change_id == null ? null : Number(states[0].next_change_id),
          lastDigestId: states[0]?.last_digest_id == null ? null : Number(states[0].last_digest_id),
        });
      } catch (err) {
        process.stderr.write(`[poe2-flip] hourly storage load failed: ${err.message}\n`);
      }
    },

    series(anchor) {
      return stores.get(anchor) ?? EMPTY_SERIES;
    },

    seedSynthetic(anchor, points) {
      stores.get(anchor)?.seed(points);
    },

    hourly() {
      return hourlyStore;
    },

    async recordHourlyDigest(digest) {
      const inserted = await hourlyStore.recordDigest(digest);
      if (!sql) return inserted;
      try {
        const rows = digest.candles.map((c) => ({
          game: scope.game,
          realm: scope.realm,
          league: scope.league,
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
        await withTimeout(sql.begin(async (tx) => {
          if (rows.length) await tx`insert into hourly_market_candles ${tx(rows)} on conflict do nothing`;
          await tx`
            insert into cxapi_state (game, realm, league, provider, next_change_id, last_digest_id, updated_at)
            values (${scope.game}, ${scope.realm}, ${scope.league}, ${scope.mode},
                    ${digest.nextChangeId ?? null}, ${digest.digestId ?? null}, now())
            on conflict (game, realm, league, provider) do update set
              next_change_id = excluded.next_change_id,
              last_digest_id = excluded.last_digest_id,
              updated_at = excluded.updated_at`;
        }), OP_TIMEOUT_MS, "recordHourlyDigest");
      } catch (err) {
        process.stderr.write(`[poe2-flip] storage recordHourlyDigest failed: ${err.message}\n`);
      }
      return inserted;
    },

    async recordSuccessfulCycle({ cycleId, startedAt, durationMs, anchors }) {
      // In-memory FIRST so reads work even if the DB write fails or stalls.
      for (const { anchor, marketPoints } of anchors) stores.get(anchor)?.record(marketPoints);
      if (!sql) return;
      try {
        await withTimeout(
          sql.begin(async (tx) => {
            for (const { anchor, fetchedAt, marketPoints } of anchors) {
              await tx`
                insert into snapshot_runs
                  (cycle_id, game, realm, league, anchor, provider, started_at, fetched_at, duration_ms, ok)
                values
                  (${cycleId}, ${scope.game}, ${scope.realm}, ${scope.league}, ${anchor}, ${scope.mode},
                   ${new Date(startedAt)}, ${new Date(fetchedAt)}, ${durationMs}, true)
                on conflict (cycle_id, anchor) do nothing`;
              if (marketPoints.length) {
                const rows = marketPoints.map((p) => ({
                  game: scope.game,
                  realm: scope.realm,
                  league: scope.league,
                  anchor,
                  provider: scope.mode,
                  target: p.target,
                  observed_at: new Date(p.t),
                  best_entry: p.bestEntry,
                  best_exit: p.bestExit,
                  spread_pct: p.spreadPct,
                  depth_entry: p.depthEntry,
                  depth_exit: p.depthExit,
                  synthetic: scope.mode === "fixture",
                  cycle_id: cycleId,
                }));
                await tx`insert into market_points ${tx(rows)} on conflict do nothing`;
              }
            }
          }),
          OP_TIMEOUT_MS,
          "recordSuccessfulCycle",
        );
      } catch (err) {
        process.stderr.write(`[poe2-flip] storage recordSuccessfulCycle failed: ${err.message}\n`);
      }
    },

    async recordFailedCycle({ cycleId, startedAt, durationMs, anchors, error }) {
      if (!sql) return;
      try {
        await withTimeout(
          sql.begin(async (tx) => {
            for (const anchor of anchors) {
              await tx`
                insert into snapshot_runs
                  (cycle_id, game, realm, league, anchor, provider, started_at, duration_ms, ok, error_code, error_message)
                values
                  (${cycleId}, ${scope.game}, ${scope.realm}, ${scope.league}, ${anchor}, ${scope.mode},
                   ${new Date(startedAt)}, ${durationMs}, false, ${error?.code ?? null}, ${error?.message ?? null})
                on conflict (cycle_id, anchor) do nothing`;
            }
          }),
          OP_TIMEOUT_MS,
          "recordFailedCycle",
        );
      } catch (err) {
        process.stderr.write(`[poe2-flip] storage recordFailedCycle failed: ${err.message}\n`);
      }
    },

    async close() {
      if (sql) await sql.end({ timeout: 5 }).catch(() => {});
    },
  };
}
