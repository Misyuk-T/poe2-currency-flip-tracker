/**
 * Daily job: resolve the Metadata ids the live exchange started trading that the
 * committed identity snapshot has never heard of, and store the answer in
 * `cx_identity` (migration 010).
 *
 * The honest framing: this changes what an item is CALLED and what picture sits
 * next to it. It never touches a market number. That is why it may auto-apply at
 * all — a wrong icon is a cosmetic bug you can see, a wrong price is a lie you
 * cannot. (Product decision, Taras, 2026-09-02; docs/DYNAMIC-DATA-PLAN-2026-09.md
 * "Design principles" 3.)
 *
 * The resolution itself is NOT implemented here. It is the same pure join the
 * two build scripts use — src/domain/identity-resolve.js — fed the same two
 * upstream documents from the same URLs. This module is only the I/O and the
 * guard rails around it:
 *
 *   - only ids actually seen in candles in the last 7 days (one bounded query)
 *   - minus everything the committed JSON already answers
 *   - minus everything already resolved in the table (a row WITH an icon is
 *     done; a row without one is retried after RETRY_AFTER_MS)
 *   - at most MAX_IDS_PER_RUN per run
 *   - sanity floors on both upstream documents before a single row is written,
 *     so a truncated or reshaped response can never overwrite good identity with
 *     a page of nulls
 *   - upserts that keep the better value per field (see upsertCxIdentity)
 *
 * `src/data/cx-identity-*.json` and `npm run identity:build` deliberately stay:
 * they are the cold-start fallback (no database, migration unapplied, job never
 * run) and the safety net if RePoE or GGG's static feed moves. Do not delete.
 */

import { loadConfig } from "../../../src/server/config.js";
import { iconUrlFromArt, isKnownCurrency, metadataForShortId } from "../../../src/domain/cx-identity.js";
import { buildIdentityEntries } from "../../../src/domain/identity-resolve.js";
import { createRadarRepository } from "../../../src/storage/radar-repository.js";
import { getSql, resetSql, withDbRetry } from "./db.js";
import { gameConfigs } from "./radar-backend.js";
import { resetIdentityOverridesCache } from "./identity-overrides.js";

// The exact upstream URLs the build scripts use. Read from the scripts, not
// invented: scripts/build-identity.mjs + scripts/build-catalog.mjs (PoE2) and
// scripts/build-identity-poe1.mjs (PoE1). Keep them in lockstep — a job and a
// script that disagree about the source are two identity maps, not one.
export const REPOE_BASE_ITEM_URLS = Object.freeze({
  poe2: "https://repoe-fork.github.io/poe2/base_items.min.json",
  poe1: "https://repoe-fork.github.io/base_items.min.json",
});
export const TRADE_STATIC_URLS = Object.freeze({
  poe2: "https://www.pathofexile.com/api/trade2/data/static",
  poe1: "https://www.pathofexile.com/api/trade/data/static",
});
const TRADE_STATIC_BASE = "https://www.pathofexile.com";
const USER_AGENT = process.env.USER_AGENT ?? "exileradar.com identity refresh (non-commercial)";

// PoE1 has no name-joinable trade catalog for short ids; only the three core
// currencies are pinned, exactly as scripts/build-identity-poe1.mjs does.
const POE1_CORE_SHORT_IDS = Object.freeze({
  "Metadata/Items/Currency/CurrencyRerollRare": "chaos",
  "Metadata/Items/Currency/CurrencyModValues": "divine",
  "Metadata/Items/Currency/CurrencyAddModToRare": "exalted",
});

/** How far back the observation query looks. Matches the storage retention window. */
const OBSERVATION_DAYS = 7;
/** Hard cap per run. Bounds both the upsert loop and the blast radius of a bad upstream day. */
const MAX_IDS_PER_RUN = 200;
/** A row that still has no icon is retried after this long, not every run. */
const RETRY_AFTER_MS = 7 * 86_400_000;
/** Per-fetch budget; two fetches plus ≤200 upserts must fit the route's maxDuration = 60. */
const FETCH_TIMEOUT_MS = 10_000;
/**
 * Sanity floors. RePoE ships thousands of base items and GGG's static feed
 * hundreds of entries; anything dramatically smaller is a truncated response, a
 * error page served as JSON, or a schema change — none of which should be
 * allowed to write rows. Mirrors MIN_ITEMS in scripts/build-catalog.mjs.
 */
const MIN_BASE_ITEMS = 1_000;
const MIN_CATALOG_ITEMS = 100;

const noop = () => {};

/** Only full Metadata paths are candidates: a short id is already canonical. */
const isMetadataId = (id) => typeof id === "string" && id.startsWith("Metadata/");

/**
 * Taxonomy sources we are willing to STORE a category from.
 *
 * `repo-class` is RePoE's internal item class, humanized ("Stackable Currency"),
 * and `unresolved` is nothing at all. Neither is an official trade category —
 * and because the reader takes DB over JSON per field and the upsert never
 * degrades a value, writing one would PERMANENTLY shadow the better category a
 * later `npm run identity:build` puts in the committed snapshot. So those two
 * are stored as null and the JSON/humanized fallback keeps answering.
 */
const TRUSTED_TAXONOMY_SOURCES = new Set(["official-id", "official-name", "official-path-token", "learned-prefix"]);

/**
 * The observed ids, expressed the way the resolver needs them: Metadata paths.
 *
 * This matters more than it looks. `hourly_market_candles` stores CANONICAL ids
 * — for PoE2 the ingest has already rewritten every id the committed bridge
 * knows into a trade short id ("chaos"), and only the unmapped tail keeps its
 * raw Metadata path. But both consumers of `observedIds` key on Metadata paths:
 * `buildIdentityTaxonomy` seeds its prefix learning from them
 * (src/domain/identity-taxonomy.js), and `chooseShortIdOwner` settles name
 * collisions with them (src/domain/identity-collision.js). Handing them short
 * ids would silently disable both — new siblings would fall through to
 * `repo-class`, and contested names would be decided by a blind sort.
 *
 * So every short id is reverse-mapped through the committed bridge and raw
 * Metadata paths pass through untouched. The result is the set of ids GGG
 * actually lists markets for — the same thing `fetchTradedIds()` collects in
 * scripts/build-identity.mjs, just read from our own candles instead of the CDN.
 */
export function observedMetadataIds(observed, game = "poe2") {
  const ids = new Set();
  for (const id of observed ?? []) {
    if (isMetadataId(id)) {
      ids.add(id);
      continue;
    }
    const metadataId = metadataForShortId(id, game);
    if (metadataId) ids.add(metadataId);
  }
  return ids;
}

function defaultMakeRepo(scope) {
  const sql = getSql();
  return sql
    ? createRadarRepository({
        sql,
        scope,
        onTimeout: () => resetSql({ timeout: 0 }),
      })
    : null;
}

/**
 * Fetch JSON with a bounded budget and ONE retry.
 *
 * A retry here is cheap and worth it (unlike on the read path): the job runs
 * once a day, and a single upstream blip otherwise costs a whole day of
 * unlabelled currencies. Both attempts together stay well inside maxDuration.
 */
async function fetchJson(url, { fetchImpl = fetch, timeoutMs = FETCH_TIMEOUT_MS, attempts = 2, trace = noop, label } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: { Accept: "application/json", "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`${label} returned ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      trace("cx-identity.fetch.retry", {
        label,
        attempt,
        errorName: error?.name ?? "Error",
        errorMessage: error?.message ?? String(error),
      });
    }
  }
  throw lastError;
}

/**
 * GGG's trade static feed -> the catalog item shape identity-resolve.js joins on.
 * Same parse as scripts/build-catalog.mjs: dedupe by id, absolutize the image
 * URL, fall back to the group id when a group carries no label.
 */
export function catalogItemsFromTradeStatic(data) {
  const items = [];
  const seen = new Set();
  for (const group of data?.result ?? []) {
    for (const entry of group?.entries ?? []) {
      if (!entry?.id || !entry?.text || seen.has(entry.id)) continue;
      seen.add(entry.id);
      const image = entry.image
        ? (entry.image.startsWith("http") ? entry.image : TRADE_STATIC_BASE + entry.image)
        : null;
      items.push({ id: entry.id, name: entry.text, category: group.label ?? group.id ?? "Unknown", image });
    }
  }
  return items;
}

/**
 * Which observed ids still need work, and why.
 *
 * Pure so the selection rule — the part that decides how much the job costs and
 * how often it retries — is testable without a database or a network.
 *
 * @returns {{ unresolved: string[], candidates: string[] }} `unresolved` is every
 *   observed Metadata id the committed JSON cannot answer (what /api/status
 *   reports); `candidates` is the subset this run should actually fetch for.
 */
export function selectIdentityCandidates(observedIds, existingRows, {
  game = "poe2",
  now = Date.now(),
  retryAfterMs = RETRY_AFTER_MS,
} = {}) {
  const byId = new Map((existingRows ?? []).map((row) => [row.metadataId, row]));
  const unresolved = [];
  const candidates = [];
  for (const id of observedIds ?? []) {
    if (!isMetadataId(id)) continue;
    // The committed snapshot is checked WITHOUT overrides on purpose: the
    // question is "does the shipped fallback already answer this", and a DB row
    // answering it is handled by the next test.
    if (isKnownCurrency(id, game)) continue;
    unresolved.push(id);
    const row = byId.get(id);
    // A row with an icon is finished — icon is the last field to resolve, so it
    // implies a name and (almost always) a category.
    if (row?.icon) continue;
    // A row without one is a placeholder: retry it, but on a schedule, not on
    // every run. Upstream does not gain an icon overnight.
    if (row && Number.isFinite(row.updatedAt) && now - row.updatedAt < retryAfterMs) continue;
    candidates.push(id);
  }
  return { unresolved, candidates };
}

/**
 * Shape one resolved identity entry into a `cx_identity` row.
 *
 * `source` records how much upstream actually knew, which is what makes the
 * retry window and the /api/status count meaningful: 'humanized' means neither
 * source recognised the id and we only title-cased its leaf.
 */
export function identityRowFor(metadataId, entry, { game = "poe2", knownUpstream = false } = {}) {
  const icon = entry?.icon ?? iconUrlFromArt(entry?.art, game) ?? null;
  // Only an OFFICIAL trade category is worth storing — see TRUSTED_TAXONOMY_SOURCES.
  const category = TRUSTED_TAXONOMY_SOURCES.has(entry?.taxonomySource) ? entry?.category ?? null : null;
  const source = !knownUpstream ? "humanized" : icon || entry?.shortId ? "repoe-catalog" : "repoe";
  return {
    metadataId,
    name: entry?.name ?? null,
    icon,
    category,
    // The column exists (migration 010) but nothing writes it yet. Subcategory is
    // DERIVED presentation taxonomy (catalogTaxonomy), not something upstream
    // told us — deriving it here would freeze today's derivation into a row that
    // outranks tomorrow's code, for a field no reader consumes. Null until a real
    // source exists.
    subcategory: null,
    shortId: entry?.shortId ?? null,
    source,
  };
}

/**
 * Resolve and store identity for one game.
 *
 * Best-effort by construction: every failure is traced and returned, never
 * thrown past the caller, because a day without new names is not an outage.
 *
 * @returns {Promise<{ scanned:number, unresolved:number, resolved:number,
 *                     written:number, skipped:number }>}
 */
export async function refreshCurrencyIdentity({
  game = "poe2",
  config = loadConfig(),
  now = Date.now(),
  trace = noop,
  makeRepo = defaultMakeRepo,
  fetchImpl = fetch,
  limit = MAX_IDS_PER_RUN,
  observationDays = OBSERVATION_DAYS,
  retryAfterMs = RETRY_AFTER_MS,
} = {}) {
  const empty = { game, scanned: 0, unresolved: 0, resolved: 0, written: 0, skipped: 0 };
  const stream = (config.cxapiStreams ?? []).find((entry) => entry.game === game);
  const scope = {
    game,
    realm: stream?.realm ?? game,
    // Identity is league-independent; the scope key just has to be complete.
    league: game === "poe1" ? config.poe1League : config.league,
    mode: config.providerMode,
  };
  trace("cx-identity.scope.start", { game, realm: scope.realm, provider: scope.mode });

  const repo = makeRepo(scope);
  if (!repo?.listObservedCurrencyIds || !repo?.readCxIdentity || !repo?.upsertCxIdentity) {
    const skipped = { ...empty, skippedReason: "no-database" };
    trace("cx-identity.scope.end", skipped);
    return skipped;
  }

  const observed = await withDbRetry(() => repo.listObservedCurrencyIds({ days: observationDays }));
  const existing = await withDbRetry(() => repo.readCxIdentity({ game }));
  const { unresolved, candidates } = selectIdentityCandidates(observed, existing, { game, now, retryAfterMs });
  const ids = candidates.slice(0, limit);
  const result = {
    ...empty,
    scanned: observed.length,
    unresolved: unresolved.length,
    // Everything the cap left behind. It is picked up by the next run, which is
    // why the cap is safe: identity converges over days, not in one shot.
    skipped: candidates.length - ids.length,
  };
  trace("cx-identity.scan.end", {
    game,
    scanned: result.scanned,
    unresolved: result.unresolved,
    candidates: candidates.length,
    selected: ids.length,
  });
  if (!ids.length) {
    trace("cx-identity.scope.end", result);
    return result;
  }

  let baseItems;
  let catalogItems;
  try {
    trace("cx-identity.fetch.start", { game });
    const [base, staticData] = await Promise.all([
      fetchJson(REPOE_BASE_ITEM_URLS[game], { fetchImpl, trace, label: "RePoE base_items" }),
      fetchJson(TRADE_STATIC_URLS[game], { fetchImpl, trace, label: "GGG trade static" }),
    ]);
    baseItems = base && typeof base === "object" ? base : {};
    catalogItems = catalogItemsFromTradeStatic(staticData);
    trace("cx-identity.fetch.end", { game, baseItems: Object.keys(baseItems).length, catalogItems: catalogItems.length });
  } catch (error) {
    const failed = {
      ...result,
      error: error?.message ?? String(error),
      errorName: error?.name ?? "Error",
    };
    trace("cx-identity.fetch.error", failed);
    return failed;
  }

  // Sanity floors, checked BEFORE anything is written. A short response means the
  // upstream is having a bad day; the committed JSON and whatever is already
  // stored stay exactly as they are.
  const baseCount = Object.keys(baseItems).length;
  if (baseCount < MIN_BASE_ITEMS || catalogItems.length < MIN_CATALOG_ITEMS) {
    const rejected = {
      ...result,
      skippedReason: "sanity-floor",
      baseItems: baseCount,
      catalogItems: catalogItems.length,
    };
    trace("cx-identity.floor.rejected", rejected);
    return rejected;
  }

  // The SAME pure join the build scripts run. Observed ids seed the taxonomy's
  // prefix learning and settle short-id collisions, exactly as they do there —
  // which is why they must be Metadata paths, not the stored canonical ids.
  const { items } = buildIdentityEntries({
    baseItems,
    catalogItems,
    observedIds: observedMetadataIds(observed, game),
    coreShortIds: game === "poe1" ? POE1_CORE_SHORT_IDS : {},
    joinShortIdsByName: game === "poe2",
    attachCatalogIcon: game === "poe2",
  });

  const rows = ids.map((id) => identityRowFor(id, items[id], { game, knownUpstream: Boolean(baseItems[id]?.name) }));
  result.resolved = rows.filter((row) => row.source !== "humanized").length;
  result.written = await withDbRetry(() => repo.upsertCxIdentity(rows, { game, now }));
  // Readers must not serve a pre-job answer for the next ten minutes.
  resetIdentityOverridesCache(game);
  trace("cx-identity.scope.end", result);
  return result;
}

/**
 * Every enabled game, in sequence. Sequential on purpose: two games share the
 * instance's single pooled connection, and the upstream fetches are polite.
 * One game's failure is recorded and never fails the other or the route.
 */
export async function runCurrencyIdentityRefresh({ now = Date.now(), trace = noop, config = loadConfig(), ...options } = {}) {
  const results = [];
  for (const game of gameConfigs(config).filter((entry) => entry.enabled)) {
    try {
      results.push(await refreshCurrencyIdentity({ game: game.id, config, now, trace, ...options }));
    } catch (error) {
      const failed = {
        game: game.id,
        scanned: 0,
        unresolved: 0,
        resolved: 0,
        written: 0,
        skipped: 0,
        error: error?.message ?? String(error),
        errorCode: error?.code ?? null,
      };
      trace("cx-identity.scope.error", failed);
      results.push(failed);
    }
  }
  return results;
}
