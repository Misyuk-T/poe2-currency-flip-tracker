/**
 * THE single resolver for "which league is the default (landing) league".
 *
 * Precedence, highest first:
 *   1. env override  — LEAGUE / POE1_LEAGUE, when explicitly set and non-empty.
 *      A human pinning the default always wins; that is the launch-day escape
 *      hatch the runbook describes.
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

import { FALLBACK_LEAGUES, envLeagueOverride, loadConfig } from "../../../src/server/config.js";
import { createRadarRepository } from "../../../src/storage/radar-repository.js";
import { getSql, withDbRetry } from "./db.js";

const RESOLVE_TTL_MS = 60_000;
// Postgres: undefined_table. Expected before migration 009 is applied.
const UNDEFINED_TABLE = "42P01";

/**
 * Read paths (currency pages, sitemap, /api/config, /api/status) have no cron
 * trace to write into, and a degraded default league must never be invisible —
 * so the default trace logs instead of doing nothing. It fires at most once per
 * TTL per process, because only a cache MISS can reach it.
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

/** Postgres-backed repository for one stream, or null with no DATABASE_URL. */
function defaultMakeRepo(scope) {
  const sql = getSql();
  return sql ? createRadarRepository({ sql, scope }) : null;
}

/**
 * Stored league metadata for one game, cached. Never throws: a missing table or
 * a database hiccup degrades to an empty row set plus a trace, because the whole
 * point of this module is that the SEO scope keeps working regardless.
 */
export async function readLeagueMetaCached(game, {
  config = loadConfig(),
  trace = defaultTrace,
  now = Date.now(),
  makeRepo = defaultMakeRepo,
} = {}) {
  const cached = cache.get(game);
  if (cached && cached.expiresAt > now) return cached.entry;

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
      entry.rows = await withDbRetry(() => repo.readLeagueMeta(scope.game, scope.realm, scope.mode));
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
  cache.set(game, { expiresAt: now + RESOLVE_TTL_MS, entry });
  return entry;
}

/**
 * Resolve the default league for one game.
 *
 * @returns {Promise<{ league: string, source: "env"|"db"|"fallback" }>}
 */
export async function resolveDefaultLeague(game, {
  config = loadConfig(),
  trace = defaultTrace,
  now = Date.now(),
  makeRepo = defaultMakeRepo,
} = {}) {
  const override = envLeagueOverride(game);
  if (override) return { league: override, source: "env" };
  const { dbDefault } = await readLeagueMetaCached(game, { config, trace, now, makeRepo });
  if (dbDefault) return { league: dbDefault, source: "db" };
  // With the env unset, config.league IS the code constant (see loadConfig).
  return { league: fallbackLeague(game, config), source: "fallback" };
}
