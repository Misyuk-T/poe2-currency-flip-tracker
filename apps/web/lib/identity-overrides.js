/**
 * Runtime currency identity: the `cx_identity` rows (migration 010) that outrank
 * the committed `src/data/cx-identity-*.json` snapshot, per field.
 *
 * Deliberately shaped like apps/web/lib/default-league.js, because it sits in
 * the same place and has the same failure budget:
 *   - one bounded read per game, cached in-process for RESOLVE_TTL_MS
 *   - single-flight (the in-flight PROMISE is cached before it is awaited), so a
 *     cold burst of N concurrent requests issues one read, not N serialized
 *     behind the instance's single pooled connection
 *   - 2s, `attempts: 1`, and `onTimeout: resetSql` — postgres.js would otherwise
 *     keep the abandoned query holding the sole max:1 connection
 *   - a missing table (code deployed ahead of migration 010) is a distinct,
 *     expected, TRACED phase that degrades to an empty map
 *
 * Nothing here is load-bearing. An empty map means the radar renders exactly
 * what it renders today: the committed snapshot, then a humanized leaf. That is
 * why one attempt and a two-second budget are the right trade — the alternative
 * to a fast failure is not a better answer, it is a slower identical one.
 *
 * Callers load ONCE per request and thread the map down (see radar-backend.js).
 * There is no per-row database call anywhere in this design.
 *
 * WHERE THIS DELIBERATELY DOES NOT REACH (checked 2026-09-02, not an oversight):
 * the SEO currency pages, their OG images and the sitemap. Those are keyed by
 * TRADE SHORT IDS and get their name/icon from `apps/web/lib/market.js`, which
 * reads the committed catalog — they never call resolveCurrency. An id can only
 * become a page id by having been canonicalised at ingest, and that
 * canonicalisation (src/server/radar-ingest.js) reads the committed JSON
 * synchronously; anything this table adds is still stored under its raw Metadata
 * path and so never becomes one of those URLs. Wiring the loader in there would
 * put a database read on ~600 ISR renders to change nothing. Revisit if ingest
 * ever canonicalises from the database — then the pages inherit it, and this is
 * the loader they should use.
 */

import { loadConfig } from "../../../src/server/config.js";
import { createRadarRepository } from "../../../src/storage/radar-repository.js";
import { getSql, resetSql, withDbRetry } from "./db.js";
import { fallbackLeague, realmForGame } from "./default-league.js";

// Ten minutes: identity changes at most daily (the cron runs at 04:20 UTC), and
// a stale name for a few minutes is invisible. Much longer than the league
// resolver's 60s because nothing about this re-scopes a page.
const RESOLVE_TTL_MS = 600_000;
// Postgres: undefined_table. Expected before migration 010 is applied.
const UNDEFINED_TABLE = "42P01";
// Same reasoning as default-league.js: this sits on the request path of
// /api/radar and the ISR currency pages and is never load-bearing.
const RESOLVE_TIMEOUT_MS = 2_000;
// Hard ceiling on what one game's override map may hold. The table is the long
// TAIL — ids the committed snapshot does not answer — so this is an assertion
// about the design, not a real limit. If it is ever hit, the identity build has
// stopped shipping and that is worth noticing rather than silently paying for.
const MAX_OVERRIDES = 2_000;

const EMPTY = new Map();

/**
 * Read paths have no cron trace to write into, and a degraded identity layer
 * must not be invisible. One line per TTL per process, like the league resolver.
 */
const defaultTrace = (phase, details = {}) => {
  const level = phase.endsWith(".error") ? "error" : "warn";
  console[level](JSON.stringify({ event: "cx-identity", phase, ...details }));
};

/** game -> { expiresAt, entry } where entry is a promise of the loaded state. */
const cache = new Map();

/** Drop cached identity overrides (all games, or one). Called after a job write. */
export function resetIdentityOverridesCache(game = null) {
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

async function loadOverrides(game, { config, trace, makeRepo }) {
  const entry = { overrides: EMPTY, iconless: 0, error: null };
  const scope = {
    game,
    realm: realmForGame(game, config),
    // The read is league-independent; the repository just requires a complete
    // scope key.
    league: fallbackLeague(game, config),
    mode: config.providerMode,
  };
  const repo = makeRepo(scope);
  if (!repo?.readCxIdentity) return entry;
  let rows;
  try {
    // attempts: 1 — a retry would double an already bounded wait on a request
    // path whose fallback is correct anyway.
    rows = await withDbRetry(() => repo.readCxIdentity({ game, limit: MAX_OVERRIDES }), { attempts: 1 });
  } catch (error) {
    entry.error = error?.message ?? String(error);
    trace(error?.code === UNDEFINED_TABLE ? "cx-identity.table-missing" : "cx-identity.read.error", {
      game,
      errorCode: error?.code ?? null,
      errorMessage: entry.error,
    });
    return entry;
  }
  const overrides = new Map();
  let iconless = 0;
  for (const row of rows ?? []) {
    if (!row?.metadataId) continue;
    // A row still missing an icon is what the job's retry window will pick up
    // again; count it here so /api/status needs no second query. A row with
    // nothing usable at all is also noise in the merge, so it is skipped below.
    if (!row.icon) iconless += 1;
    if (!row.name && !row.icon && !row.category && !row.subcategory && !row.shortId) continue;
    overrides.set(row.metadataId, {
      name: row.name ?? null,
      icon: row.icon ?? null,
      category: row.category ?? null,
      subcategory: row.subcategory ?? null,
      shortId: row.shortId ?? null,
      source: row.source ?? null,
    });
  }
  entry.overrides = overrides;
  entry.iconless = iconless;
  return entry;
}

/**
 * The full loaded state for one game: `{ overrides, iconless, error }`, where
 * `iconless` counts stored rows that still have no icon.
 * Never throws — every failure mode degrades to an empty map plus a trace, and
 * the failure is cached too so the next attempt waits for the TTL rather than
 * hammering a database that just timed out.
 */
export async function readIdentityOverridesCached(game, {
  config = loadConfig(),
  trace = defaultTrace,
  now = Date.now(),
  makeRepo = defaultMakeRepo,
} = {}) {
  const cached = cache.get(game);
  if (cached && cached.expiresAt > now) return cached.entry;

  const entry = loadOverrides(game, { config, trace, makeRepo });
  cache.set(game, { expiresAt: now + RESOLVE_TTL_MS, entry });
  try {
    return await entry;
  } catch (error) {
    // loadOverrides swallows database errors, so this is a programming fault.
    // Don't let a rejected promise poison the cache for a whole TTL.
    if (cache.get(game)?.entry === entry) cache.delete(game);
    throw error;
  }
}

/**
 * `Map<metadataId, { name, icon, category, subcategory, shortId }>` for one game.
 * Empty (never null) when there is no database, no table, or no rows — so every
 * caller can pass it straight into resolveCurrency/identityNames without a guard.
 */
export async function loadIdentityOverrides(game, options = {}) {
  return (await readIdentityOverridesCached(game, options)).overrides;
}
