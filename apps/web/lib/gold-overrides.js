/**
 * Runtime gold costs: the `gold_costs` rows (migration 011) that outrank the
 * committed `src/data/gold-costs-poe2.js` table, per item.
 *
 * Same shape and the same failure budget as apps/web/lib/identity-overrides.js
 * and layout-overrides.js — one bounded read per game, cached for RESOLVE_TTL_MS,
 * single-flight, 2s, `attempts: 1`, `onTimeout: resetSql`, and a missing table
 * (code deployed ahead of migration 011) as a distinct, traced, empty result.
 *
 * The difference from the other two is what a failure MEANS. Identity and layout
 * degrade to a worse label or a worse grouping. Gold degrades to the last
 * verified table shipped in git — which is a correct, older number, not a guess.
 * That is the whole reason this is allowed to auto-apply at all: every path out
 * of here lands on a number somebody sourced. A row whose `goldPerUnit` is not a
 * finite number is DROPPED rather than passed on, because an item with no
 * verified cost is reported as a coverage gap and marked unrankable, and that is
 * a better outcome than a NaN ranking a market.
 *
 * Callers load ONCE per request (or per cron run) and thread the array down. The
 * array identity is stable for the whole TTL, which is what lets radar-backend
 * memoize the merged catalog manifest against it.
 */

import { loadConfig } from "../../../src/server/config.js";
import { createRadarRepository } from "../../../src/storage/radar-repository.js";
import { getSql, resetSql, withDbRetry } from "./db.js";
import { fallbackLeague, realmForGame } from "./default-league.js";

const RESOLVE_TTL_MS = 600_000;
// Postgres: undefined_table. Expected before migration 011 is applied.
const UNDEFINED_TABLE = "42P01";
const RESOLVE_TIMEOUT_MS = 2_000;
// The committed table holds 651 rows; the catalog it matches against is ~1600.
const MAX_ROWS = 4_000;

const EMPTY = Object.freeze([]);

const defaultTrace = (phase, details = {}) => {
  const level = phase.endsWith(".error") ? "error" : "warn";
  console[level](JSON.stringify({ event: "gold-costs", phase, ...details }));
};

/** game -> { expiresAt, entry } where entry is a promise of the loaded state. */
const cache = new Map();

/** Drop cached gold overrides (all games, or one). Called after a job write. */
export function resetGoldOverridesCache(game = null) {
  if (game) cache.delete(game);
  else cache.clear();
}

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

async function loadGold(game, { config, trace, makeRepo }) {
  const entry = { records: EMPTY, rows: 0, fetchedAt: null, error: null };
  const scope = {
    game,
    realm: realmForGame(game, config),
    league: fallbackLeague(game, config),
    mode: config.providerMode,
  };
  const repo = makeRepo(scope);
  if (!repo?.readGoldCosts) return entry;
  let rows;
  try {
    rows = await withDbRetry(() => repo.readGoldCosts({ game, limit: MAX_ROWS }), { attempts: 1 });
  } catch (error) {
    entry.error = error?.message ?? String(error);
    trace(error?.code === UNDEFINED_TABLE ? "gold-costs.table-missing" : "gold-costs.read.error", {
      game,
      errorCode: error?.code ?? null,
      errorMessage: entry.error,
    });
    return entry;
  }
  const records = [];
  let fetchedAt = null;
  for (const row of rows ?? []) {
    if (!row?.itemKey) continue;
    // See the header: no number, no record. Never a null or a NaN downstream.
    if (!Number.isFinite(row.goldPerUnit)) continue;
    const observedAt = Number.isFinite(row.fetchedAt) ? new Date(row.fetchedAt).toISOString().slice(0, 10) : null;
    records.push({
      game,
      itemId: row.itemKey,
      displayName: row.displayName ?? null,
      goldPerUnit: row.goldPerUnit,
      // The registry's shape (see GoldCostRecord). `effectiveFrom` is the day
      // the value was observed upstream, so provenance shown to a user is the
      // scrape date and not "now".
      effectiveFrom: observedAt,
      patchOrVersion: observedAt ? `db-observed-${observedAt}` : "db-observed",
      source: row.source ?? "gold_costs table",
    });
    if (Number.isFinite(row.fetchedAt)) fetchedAt = Math.max(fetchedAt ?? 0, row.fetchedAt);
  }
  entry.records = records.length ? records : EMPTY;
  entry.rows = records.length;
  entry.fetchedAt = fetchedAt;
  return entry;
}

/**
 * The full loaded state for one game: `{ records, rows, fetchedAt, error }`.
 * Never throws — every failure mode degrades to an empty list plus a trace, and
 * the failure is cached too so the next attempt waits for the TTL rather than
 * hammering a database that just timed out.
 */
export async function readGoldOverridesCached(game, {
  config = loadConfig(),
  trace = defaultTrace,
  now = Date.now(),
  makeRepo = defaultMakeRepo,
} = {}) {
  const cached = cache.get(game);
  if (cached && cached.expiresAt > now) return cached.entry;

  const entry = loadGold(game, { config, trace, makeRepo });
  cache.set(game, { expiresAt: now + RESOLVE_TTL_MS, entry });
  try {
    return await entry;
  } catch (error) {
    if (cache.get(game)?.entry === entry) cache.delete(game);
    throw error;
  }
}

/**
 * The stored gold records for one game, as a stable array (never null) in the
 * shape {@link import("../../../src/domain/gold-costs.js").mergeGoldRecords}
 * expects. Empty when there is no database, no table, or no rows.
 */
export async function loadGoldOverrides(game, options = {}) {
  return (await readGoldOverridesCached(game, options)).records;
}
