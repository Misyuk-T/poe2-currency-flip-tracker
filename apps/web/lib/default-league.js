/**
 * THE single resolver for "which league is the default (landing) league".
 *
 * Precedence, highest first:
 *   1. env override  — LEAGUE / POE1_LEAGUE, when explicitly set and non-empty.
 *      A human pinning the default outranks the rule; that is the launch-day
 *      escape hatch the runbook describes. Setting it DISABLES the data-driven
 *      rule for that game: the cron still records league_meta, but nothing it
 *      decides can change what readers see until the variable is removed.
 *      Production sets LEAGUES but deliberately NOT LEAGUE, so the rule is live
 *      there. The one thing a pin cannot do is point at a league we hold no
 *      prices for — see the unpriced guard on resolveDefaultLeague.
 *   2. database      — the `league_meta.is_default` row the hourly cron persists
 *      from chooseDefaultLeague. This is the normal path in production.
 *   3. code fallback — FALLBACK_LEAGUES. Cold start, no database, or the
 *      migration has not been applied yet.
 *
 * Deploy order therefore does not matter: code that ships BEFORE migration 009
 * finds no table, traces it, and behaves exactly as it does today. The table
 * arriving later simply starts answering.
 *
 * Cached in-process for RESOLVE_TTL_MS so a request never pays a database round
 * trip just to learn the scope it is rendering. The cron invalidates the cache
 * right after it persists a new default, so snapshots in the same run see it.
 */

import { chooseDefaultLeague } from "../../../src/domain/league-default.js";
import { FALLBACK_LEAGUES, envLeagueOverride, loadConfig } from "../../../src/server/config.js";
import { createRadarRepository } from "../../../src/storage/radar-repository.js";
import { getSql, resetSql, withDbRetry } from "./db.js";

const RESOLVE_TTL_MS = 60_000;
// Postgres: undefined_table. Expected before migration 009 is applied.
const UNDEFINED_TABLE = "42P01";
// This read sits on the REQUEST path of /api/radar (maxDuration 30) and of the
// ISR currency pages, and it is never load-bearing: every failure mode has an
// answer. So it gets a budget an order of magnitude tighter than the radar's own
// 18s — inheriting that, plus the 15s server-side statement_timeout, plus a
// withDbRetry attempt, could burn ~20s of a 30s request to learn a league name.
// One attempt, two seconds, then fall back.
const RESOLVE_TIMEOUT_MS = 2_000;

/**
 * Read paths (currency pages, sitemap, /api/config, /api/status) have no cron
 * trace to write into, and a degraded default league must never be invisible —
 * so the default trace logs instead of doing nothing. Every caller of it is
 * de-duplicated to at most one line per TTL per process — the read failures
 * because only a cache MISS reaches them, the unpriced-default substitution by
 * an explicit marker on the cached entry.
 */
const defaultTrace = (phase, details = {}) => {
  const level = phase.endsWith(".error") ? "error" : "warn";
  console[level](JSON.stringify({ event: "league-meta", phase, ...details }));
};

/** game -> { expiresAt, entry }. Per warm process, deliberately tiny. */
const cache = new Map();

/** Drop cached league metadata (all games, or one). Called after a cron write. */
export function resetLeagueMetaCache(game = null) {
  if (game) cache.delete(game);
  else cache.clear();
}

/**
 * The realm for a game, without importing the catalog-heavy radar backend.
 * Mirrors gameConfigs(): the configured cxapi stream wins, else the game id.
 */
export function realmForGame(game, config) {
  return (config.cxapiStreams ?? []).find((stream) => stream.game === game)?.realm ?? game;
}

export function fallbackLeague(game, config = null) {
  if (config) {
    if (game === "poe2" && config.league) return config.league;
    if (game === "poe1" && config.poe1League) return config.poe1League;
  }
  return FALLBACK_LEAGUES[game] ?? FALLBACK_LEAGUES.poe2;
}

/**
 * Postgres-backed repository for one stream, or null with no DATABASE_URL.
 * Tightly budgeted (see RESOLVE_TIMEOUT_MS) and, like every other call site,
 * destroying the cached client on timeout — postgres.js would otherwise keep the
 * abandoned query holding the instance's single pooled connection (max: 1) until
 * the function is killed.
 */
function defaultMakeRepo(scope) {
  const sql = getSql();
  return sql
    ? createRadarRepository({
        sql,
        scope,
        opTimeoutMs: RESOLVE_TIMEOUT_MS,
        onTimeout: () => resetSql({ timeout: 0 }),
      })
    : null;
}

async function loadLeagueMeta(game, { config, trace, makeRepo }) {
  const entry = { rows: [], byLeague: new Map(), dbDefault: null, error: null };
  const scope = {
    game,
    realm: realmForGame(game, config),
    // The read is league-independent; the repository just requires a complete
    // scope key.
    league: fallbackLeague(game, config),
    mode: config.providerMode,
  };
  const repo = makeRepo(scope);
  if (repo?.readLeagueMeta) {
    try {
      // attempts: 1 — a retry would double an already bounded wait on a request
      // path whose fallback is correct anyway.
      entry.rows = await withDbRetry(
        () => repo.readLeagueMeta(scope.game, scope.realm, scope.mode),
        { attempts: 1 },
      );
      entry.dbDefault = entry.rows.find((row) => row.isDefault)?.league ?? null;
    } catch (error) {
      entry.rows = [];
      entry.dbDefault = null;
      entry.error = error?.message ?? String(error);
      // Never silent: a missing table is a distinct, expected phase (code
      // deployed ahead of the migration); anything else is a real error.
      trace(error?.code === UNDEFINED_TABLE ? "league-meta.table-missing" : "league-meta.read.error", {
        game,
        errorCode: error?.code ?? null,
        errorMessage: entry.error,
      });
    }
  }
  for (const row of entry.rows) entry.byLeague.set(row.league, row);
  return entry;
}

/**
 * Stored league metadata for one game, cached. Never throws: a missing table or
 * a database hiccup degrades to an empty row set plus a trace, because the whole
 * point of this module is that the SEO scope keeps working regardless — so a
 * failed read is cached too, and the next attempt waits for the TTL.
 *
 * Single-flight: the in-flight PROMISE is cached before it is awaited, so a cold
 * burst of N concurrent requests issues one read, not N reads serialized behind
 * the instance's single pooled connection.
 */
export async function readLeagueMetaCached(game, {
  config = loadConfig(),
  trace = defaultTrace,
  now = Date.now(),
  makeRepo = defaultMakeRepo,
} = {}) {
  const cached = cache.get(game);
  if (cached && cached.expiresAt > now) return cached.entry;

  const entry = loadLeagueMeta(game, { config, trace, makeRepo });
  cache.set(game, { expiresAt: now + RESOLVE_TTL_MS, entry });
  try {
    return await entry;
  } catch (error) {
    // loadLeagueMeta swallows database errors, so this is a programming fault.
    // Don't let a rejected promise poison the cache for a whole TTL.
    if (cache.get(game)?.entry === entry) cache.delete(game);
    throw error;
  }
}

/**
 * The best league we actually hold prices for, used when the chosen default
 * turns out to have none. Same shape of judgement as the real rule (newest
 * eligible league wins, ties break on name) but with the depth thresholds
 * lowered to "any data at all", because at this point the alternative is a page
 * with nothing on it. Falls back to the most recently seen league of any kind
 * when only permanent/private leagues have data.
 */
function bestPricedLeague(rows, game) {
  const priced = rows.filter((row) => (row.pairCount ?? 0) > 0);
  if (!priced.length) return null;
  const eligible = chooseDefaultLeague(priced, {
    game,
    currentDefault: null,
    minCompletedHours: 1,
    minPairs: 1,
  });
  if (eligible) return eligible;
  return priced.reduce((best, row) =>
    (row.lastSeenAt ?? -Infinity) > (best.lastSeenAt ?? -Infinity) ? row : best,
  ).league;
}

/**
 * Resolve the default league for one game.
 *
 * After precedence, one guard: if we hold priced candles for some leagues but
 * NONE for the chosen one, serve the best league we do have data for. Without
 * it /api/config (which already drops a league with no priced candles) and
 * /api/radar (which would keep it) could name different default leagues —
 * reachable when the env pins a league that is not in the digest, or when
 * setDefaultLeague recorded a candle-less fallback. This applies to an env pin
 * too, deliberately: pinning a league before its first candle lands is the very
 * "don't re-scope onto a day-one economy" case the rule exists to prevent, and
 * the pin takes effect on its own as soon as there is data. Always traced.
 *
 * @returns {Promise<{ league: string, source: "env"|"db"|"fallback",
 *                     unpricedFallbackFrom?: string }>}
 */
export async function resolveDefaultLeague(game, {
  config = loadConfig(),
  trace = defaultTrace,
  now = Date.now(),
  makeRepo = defaultMakeRepo,
} = {}) {
  const override = envLeagueOverride(game);
  const entry = await readLeagueMetaCached(game, { config, trace, now, makeRepo });
  // With the env unset, config.league IS the code constant (see loadConfig).
  const chosen = override
    ? { league: override, source: "env" }
    : entry.dbDefault
      ? { league: entry.dbDefault, source: "db" }
      : { league: fallbackLeague(game, config), source: "fallback" };

  if ((entry.byLeague.get(chosen.league)?.pairCount ?? 0) > 0) return chosen;
  const priced = bestPricedLeague(entry.rows, game);
  if (!priced || priced === chosen.league) return chosen;
  // Unlike the read failures above, this runs on every resolve — including cache
  // hits — so it is de-duplicated against the cached entry to stay one line per
  // TTL rather than one per request.
  const substitution = `${chosen.source}|${chosen.league}|${priced}`;
  if (entry.tracedUnpriced !== substitution) {
    entry.tracedUnpriced = substitution;
    trace("league-meta.default.unpriced", { game, chosen: chosen.league, source: chosen.source, served: priced });
  }
  return { ...chosen, league: priced, unpricedFallbackFrom: chosen.league };
}
