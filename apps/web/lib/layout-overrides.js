/**
 * Runtime exchange layout: the `exchange_layout` rows (migration 011) that
 * outrank the committed `src/data/exchange-layout-*.json` snapshot, per item and
 * per field.
 *
 * Deliberately shaped like apps/web/lib/identity-overrides.js, because it sits
 * in the same place and has the same failure budget:
 *   - one bounded read per game, cached in-process for RESOLVE_TTL_MS
 *   - single-flight (the in-flight PROMISE is cached before it is awaited), so a
 *     cold burst of N concurrent requests issues one read, not N serialized
 *     behind the instance's single pooled connection
 *   - 2s, `attempts: 1`, and `onTimeout: resetSql` — postgres.js would otherwise
 *     keep the abandoned query holding the sole max:1 connection
 *   - a missing table (code deployed ahead of migration 011) is a distinct,
 *     expected, TRACED phase that degrades to an empty list
 *
 * Nothing here is load-bearing. An empty list means the radar groups and orders
 * rows exactly as it does today: from the committed snapshot, with anything it
 * has never seen falling to "Needs classification". That is why one attempt and
 * a two-second budget are the right trade — the alternative to a fast failure is
 * not a better answer, it is a slower identical one.
 *
 * Callers load ONCE per request (or per cron run) and thread the array down. The
 * array identity is stable for the whole TTL, which is what lets
 * src/domain/exchange-layout.js memoize the merged store against it instead of
 * re-merging ~700-1100 items per request. There is no per-row database call
 * anywhere in this design.
 */

import { loadConfig } from "../../../src/server/config.js";
import { createRadarRepository } from "../../../src/storage/radar-repository.js";
import { getSql, resetSql, withDbRetry } from "./db.js";
import { fallbackLeague, realmForGame } from "./default-league.js";

// Ten minutes, matching the identity loader: the layout changes at most daily
// (the cron runs at 04:40 UTC), and a section that moves a few minutes late is
// invisible.
const RESOLVE_TTL_MS = 600_000;
// Postgres: undefined_table. Expected before migration 011 is applied.
const UNDEFINED_TABLE = "42P01";
// This sits on the /api/radar rebuild path and is never load-bearing.
const RESOLVE_TIMEOUT_MS = 2_000;
// Ceiling on one game's stored layout. PoE1 ships ~1130 items and PoE2 ~670, so
// this is an assertion about the design rather than a real limit.
const MAX_ROWS = 4_000;

const EMPTY = Object.freeze([]);

const defaultTrace = (phase, details = {}) => {
  const level = phase.endsWith(".error") ? "error" : "warn";
  console[level](JSON.stringify({ event: "exchange-layout", phase, ...details }));
};

/** game -> { expiresAt, entry } where entry is a promise of the loaded state. */
const cache = new Map();

/** Drop cached layout overrides (all games, or one). Called after a job write. */
export function resetLayoutOverridesCache(game = null) {
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

async function loadLayout(game, { config, trace, makeRepo }) {
  const entry = { items: EMPTY, rows: 0, fetchedAt: null, error: null };
  const scope = {
    game,
    realm: realmForGame(game, config),
    // The read is league-independent; the repository just requires a complete
    // scope key.
    league: fallbackLeague(game, config),
    mode: config.providerMode,
  };
  const repo = makeRepo(scope);
  if (!repo?.readExchangeLayout) return entry;
  let rows;
  try {
    // attempts: 1 — a retry would double an already bounded wait on a request
    // path whose fallback is correct anyway.
    rows = await withDbRetry(() => repo.readExchangeLayout({ game, limit: MAX_ROWS }), { attempts: 1 });
  } catch (error) {
    entry.error = error?.message ?? String(error);
    trace(error?.code === UNDEFINED_TABLE ? "exchange-layout.table-missing" : "exchange-layout.read.error", {
      game,
      errorCode: error?.code ?? null,
      errorMessage: entry.error,
    });
    return entry;
  }
  const items = [];
  let fetchedAt = null;
  for (const row of rows ?? []) {
    if (!row?.itemKey) continue;
    // A row that cannot place an item is noise in the merge: the whole point of
    // a stored row is the (category, section, order) triple.
    if (row.category == null && row.section == null) continue;
    items.push({
      metadataId: row.metadataId ?? null,
      name: row.name ?? null,
      normalizedName: row.normalizedName ?? null,
      href: row.href ?? null,
      category: row.category ?? null,
      categoryOrder: row.categoryOrder ?? null,
      section: row.section ?? null,
      sectionOrder: row.sectionOrder ?? null,
      itemOrder: row.itemOrder ?? null,
    });
    if (Number.isFinite(row.fetchedAt)) fetchedAt = Math.max(fetchedAt ?? 0, row.fetchedAt);
  }
  entry.items = items.length ? items : EMPTY;
  entry.rows = items.length;
  entry.fetchedAt = fetchedAt;
  return entry;
}

/**
 * The full loaded state for one game: `{ items, rows, fetchedAt, error }`.
 * Never throws — every failure mode degrades to an empty list plus a trace, and
 * the failure is cached too so the next attempt waits for the TTL rather than
 * hammering a database that just timed out.
 */
export async function readLayoutOverridesCached(game, {
  config = loadConfig(),
  trace = defaultTrace,
  now = Date.now(),
  makeRepo = defaultMakeRepo,
} = {}) {
  const cached = cache.get(game);
  if (cached && cached.expiresAt > now) return cached.entry;

  const entry = loadLayout(game, { config, trace, makeRepo });
  cache.set(game, { expiresAt: now + RESOLVE_TTL_MS, entry });
  try {
    return await entry;
  } catch (error) {
    // loadLayout swallows database errors, so this is a programming fault. Don't
    // let a rejected promise poison the cache for a whole TTL.
    if (cache.get(game)?.entry === entry) cache.delete(game);
    throw error;
  }
}

/**
 * The stored layout items for one game, as a stable array (never null) that can
 * be passed straight into applyExchangeLayout/exchangeLayoutCategories without a
 * guard. Empty when there is no database, no table, or no rows.
 */
export async function loadLayoutOverrides(game, options = {}) {
  return (await readLayoutOverridesCached(game, options)).items;
}
