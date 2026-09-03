/**
 * Daily job: reparse the two upstream pages the committed data snapshots are
 * built from, and store the answer in `exchange_layout` and `gold_costs`
 * (migration 011).
 *
 * Two facts, two very different honesty gates (docs/DYNAMIC-DATA-PLAN-2026-09.md,
 * "Design principles" 3; product decision Taras 2026-09-02):
 *
 *   LAYOUT — which category and section an item sits in, and in what order.
 *     Cosmetic. A wrong section is a bug you can see. It auto-applies behind a
 *     coverage floor derived from the committed snapshot.
 *
 *   GOLD — how much gold a leg costs. A NUMBER users act on. It auto-applies
 *     only behind the existing MIN_MATCHED = 500 coverage floor AND a volatility
 *     guard, and a refused batch keeps the previously stored values. It never
 *     invents, interpolates or carries forward a value for an item it could not
 *     match: an unmatched item is simply absent, surfaces as a coverage gap and
 *     the target is marked unrankable.
 *
 * Neither parse is implemented here. Both are the same pure functions the build
 * scripts run — src/domain/exchange-layout-parse.js and
 * src/domain/gold-costs-parse.js — fed the same documents from the same URLs.
 * This module is only the I/O and the guard rails:
 *
 *   - one bounded fetch per upstream (10s) with ONE retry
 *   - floors checked BEFORE a single row is written
 *   - batched upserts (50) with per-field `coalesce`, so a null never blanks a
 *     stored value and a row upstream stopped listing is never deleted
 *   - every failure traced and RETURNED, never thrown past the caller: a day
 *     without a refresh is not an outage, it is yesterday's data
 *
 * `src/data/exchange-layout-*.json`, `src/data/gold-costs-poe2.js` and their
 * build scripts deliberately stay: they are the cold-start fallback (no
 * database, migration unapplied, job never run) and the safety net if
 * poedb/poe2db move. Do not delete.
 */

import { loadConfig } from "../../../src/server/config.js";
import { loadCatalog } from "../../../src/domain/catalog.js";
import {
  LAYOUT_SOURCE_URLS,
  exchangeLayoutItemKey,
  parseExchangeLayoutHtml,
  preserveKnownMetadataIds,
} from "../../../src/domain/exchange-layout-parse.js";
import { committedExchangeLayout } from "../../../src/domain/exchange-layout.js";
import {
  GOLD_SOURCE_URL,
  checkGoldCoverage,
  checkGoldVolatility,
  matchGoldCosts,
  parseGoldCostsHtml,
} from "../../../src/domain/gold-costs-parse.js";
import { POE2_GOLD_COSTS } from "../../../src/data/gold-costs-poe2.js";
import { createRadarRepository } from "../../../src/storage/radar-repository.js";
import { getSql, resetSql, withDbRetry } from "./db.js";
import { gameConfigs } from "./radar-backend.js";
import { resetLayoutOverridesCache } from "./layout-overrides.js";
import { resetGoldOverridesCache } from "./gold-overrides.js";

export { GOLD_SOURCE_URL, LAYOUT_SOURCE_URLS };

const USER_AGENT = process.env.USER_AGENT ?? "exileradar.com data refresh (non-commercial)";

/** Per-fetch budget; three fetches plus the upserts must fit the route's maxDuration = 60. */
const FETCH_TIMEOUT_MS = 10_000;

/**
 * Coverage floor for the layout, as a FRACTION of what the committed snapshot
 * knows rather than an absolute: the two games differ by 400 items and a league
 * legitimately adds a category. 80% catches a truncated page, a changed markup
 * class and a half-rendered response, which is what it is for.
 */
const LAYOUT_MIN_COVERAGE = 0.8;

/** Gold: the only game with a scrapeable table and a trade catalog to match it against. */
const GOLD_GAMES = new Set(["poe2"]);

const noop = () => {};

/**
 * Fetch HTML with a bounded budget and ONE retry.
 *
 * A retry here is cheap and worth it (unlike on the read path): the job runs
 * once a day, and a single upstream blip otherwise costs a whole day of stale
 * layout. Both attempts together stay well inside maxDuration.
 */
async function fetchHtml(url, { fetchImpl = fetch, timeoutMs = FETCH_TIMEOUT_MS, attempts = 2, trace = noop, label } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: { Accept: "text/html", "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`${label} returned ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      trace("data-refresh.fetch.retry", {
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
 * One fetch per URL for the whole run.
 *
 * PoE2's layout and its gold table are THE SAME PAGE
 * (https://poe2db.tw/us/Currency_Exchange) read with two different parsers, so a
 * naive run would download it twice. That is impolite to a fan site we do not
 * pay for, and it wastes ~10s of a 60s budget — but it also means the two tasks
 * could disagree, describing two different snapshots of a page that changed
 * between them. Sharing the body makes them describe one.
 *
 * Only a SUCCESSFUL body is shared. A failed or thrown attempt is evicted so the
 * per-fetch retry (and the next task) really does try again.
 */
export function cachingFetch(fetchImpl = fetch) {
  const cache = new Map();
  return async (url, init) => {
    if (!cache.has(url)) {
      cache.set(
        url,
        (async () => {
          const response = await fetchImpl(url, init);
          if (!response.ok) return { ok: false, status: response.status, body: "" };
          return { ok: true, status: response.status, body: await response.text() };
        })(),
      );
    }
    let cached;
    try {
      cached = await cache.get(url);
    } catch (error) {
      cache.delete(url);
      throw error;
    }
    if (!cached.ok) cache.delete(url);
    return { ok: cached.ok, status: cached.status, text: async () => cached.body };
  };
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

function scopeFor(game, config) {
  const stream = (config.cxapiStreams ?? []).find((entry) => entry.game === game);
  return {
    game,
    realm: stream?.realm ?? game,
    // Both tables are league-independent; the scope key just has to be complete.
    league: game === "poe1" ? config.poe1League : config.league,
    mode: config.providerMode,
  };
}

const emptyResult = (game, task) => ({
  game,
  task,
  scanned: 0,
  parsed: 0,
  written: 0,
  skipped: 0,
  rejected: 0,
  reason: null,
});

/** Total sections across a parsed or committed snapshot's category tree. */
function sectionCount(categories) {
  return (categories ?? []).reduce((total, category) => total + (category.sections?.length ?? 0), 0);
}

/**
 * Shape one parsed layout item into an `exchange_layout` row.
 *
 * Everything the reader consumes plus the two fields that keep the key stable:
 * the Metadata id (the key itself, when present) and the normalized name (the
 * key otherwise, and the reader's second lookup index).
 */
export function layoutRowFor(item, { source = null } = {}) {
  const itemKey = exchangeLayoutItemKey(item);
  if (!itemKey) return null;
  return {
    itemKey,
    metadataId: item.metadataId ?? null,
    name: item.name ?? null,
    normalizedName: item.normalizedName ?? null,
    href: item.href ?? null,
    category: item.category ?? null,
    categoryOrder: item.categoryOrder ?? null,
    section: item.section ?? null,
    sectionOrder: item.sectionOrder ?? null,
    itemOrder: item.itemOrder ?? null,
    source,
  };
}

/**
 * Refresh one game's exchange layout.
 *
 * @returns {Promise<{ game:string, task:'layout', scanned:number, parsed:number,
 *                     written:number, skipped:number, rejected:number,
 *                     reason:string|null }>}
 *   `scanned` items came off the page, `parsed` of them produced a usable row,
 *   `skipped` could not be keyed, `written` were upserted, and `rejected` is how
 *   many rows a floor refused (the previous rows stand in that case).
 */
export async function refreshExchangeLayout({
  game = "poe2",
  config = loadConfig(),
  now = Date.now(),
  trace = noop,
  makeRepo = defaultMakeRepo,
  fetchImpl = fetch,
  minCoverage = LAYOUT_MIN_COVERAGE,
} = {}) {
  const result = emptyResult(game, "layout");
  const sourceUrl = LAYOUT_SOURCE_URLS[game];
  if (!sourceUrl) {
    result.reason = "unsupported-game";
    trace("data-refresh.layout.end", result);
    return result;
  }
  trace("data-refresh.layout.start", { game, sourceUrl });

  const repo = makeRepo(scopeFor(game, config));
  if (!repo?.upsertExchangeLayout) {
    result.reason = "no-database";
    trace("data-refresh.layout.end", result);
    return result;
  }

  let parsed;
  try {
    const html = await fetchHtml(sourceUrl, { fetchImpl, trace, label: `${game} exchange layout` });
    // The SAME pure parse the nightly script runs, including the metadata-id
    // recovery it applies when the page swaps data-hover for an opaque cache
    // URL. The committed snapshot is the "previous" there, exactly as it is for
    // the script; the upsert's coalesce covers the rest.
    parsed = preserveKnownMetadataIds(
      parseExchangeLayoutHtml(html, { game, sourceUrl }),
      committedExchangeLayout(game),
    );
  } catch (error) {
    result.reason = "fetch-or-parse-failed";
    result.error = error?.message ?? String(error);
    result.errorName = error?.name ?? "Error";
    trace("data-refresh.layout.error", result);
    return result;
  }

  result.scanned = parsed.items?.length ?? 0;
  const rows = [];
  for (const item of parsed.items ?? []) {
    const row = layoutRowFor(item, { source: sourceUrl });
    if (row) rows.push(row);
  }
  result.parsed = rows.length;
  result.skipped = result.scanned - rows.length;

  // The floor, checked BEFORE anything is written and derived from the committed
  // snapshot rather than from a magic number: a page that lost a fifth of its
  // items or a fifth of its sections is having a bad day, and the stored rows
  // plus the committed file stay exactly as they are.
  const committed = committedExchangeLayout(game);
  const itemFloor = Math.ceil((committed.items?.length ?? 0) * minCoverage);
  const sectionFloor = Math.ceil(sectionCount(committed.categories) * minCoverage);
  const sections = sectionCount(parsed.categories);
  if (rows.length < itemFloor || sections < sectionFloor) {
    result.rejected = rows.length;
    result.reason = "coverage-floor";
    result.itemFloor = itemFloor;
    result.sectionFloor = sectionFloor;
    result.sections = sections;
    trace("data-refresh.layout.floor.rejected", result);
    return result;
  }

  result.written = await withDbRetry(() => repo.upsertExchangeLayout(rows, { game, now }));
  // Readers must not serve a pre-job answer for the next ten minutes.
  resetLayoutOverridesCache(game);
  result.sections = sections;
  trace("data-refresh.layout.end", result);
  return result;
}

/**
 * The baseline the volatility guard compares against: what is stored now, or —
 * on the very first run, when nothing is stored — the committed table.
 *
 * Falling back to the committed file rather than to "no baseline" is the point:
 * without it the first DB write would be unguarded, which is precisely the write
 * most likely to be wrong (new code, new table, first contact with the page).
 */
export function goldBaseline(storedRows, committedRecords = POE2_GOLD_COSTS) {
  const stored = (storedRows ?? []).filter((row) => Number.isFinite(row?.goldPerUnit));
  if (stored.length) return new Map(stored.map((row) => [row.itemKey, row.goldPerUnit]));
  return new Map((committedRecords ?? []).map((record) => [record.itemId, record.goldPerUnit]));
}

/**
 * Refresh one game's gold costs.
 *
 * @returns {Promise<{ game:string, task:'gold', scanned:number, parsed:number,
 *                     written:number, skipped:number, rejected:number,
 *                     reason:string|null }>}
 *   `scanned` items came off the page, `parsed` matched exactly one catalog id,
 *   `skipped` did not match and are omitted (never guessed), `written` were
 *   upserted, and `rejected` is the whole batch when a guard refused it.
 */
export async function refreshGoldCosts({
  game = "poe2",
  config = loadConfig(),
  now = Date.now(),
  trace = noop,
  makeRepo = defaultMakeRepo,
  fetchImpl = fetch,
  catalog = null,
} = {}) {
  const result = emptyResult(game, "gold");
  if (!GOLD_GAMES.has(game)) {
    result.reason = "unsupported-game";
    trace("data-refresh.gold.end", result);
    return result;
  }
  trace("data-refresh.gold.start", { game, sourceUrl: GOLD_SOURCE_URL });

  const repo = makeRepo(scopeFor(game, config));
  if (!repo?.upsertGoldCosts || !repo?.readGoldCosts) {
    result.reason = "no-database";
    trace("data-refresh.gold.end", result);
    return result;
  }

  let matched;
  let unmatched;
  try {
    const [html, resolvedCatalog] = await Promise.all([
      fetchHtml(GOLD_SOURCE_URL, { fetchImpl, trace, label: "gold costs" }),
      catalog ? Promise.resolve(catalog) : loadCatalog(),
    ]);
    const scraped = parseGoldCostsHtml(html);
    result.scanned = scraped.length;
    ({ matched, unmatched } = matchGoldCosts(scraped, resolvedCatalog));
  } catch (error) {
    result.reason = "fetch-or-parse-failed";
    result.error = error?.message ?? String(error);
    result.errorName = error?.name ?? "Error";
    trace("data-refresh.gold.error", result);
    return result;
  }
  result.parsed = matched.length;
  result.skipped = unmatched.length;

  // Guard 1: the coverage floor the build script has always enforced. Shared
  // with it, so the DB and the committed file can never disagree about what
  // "enough" means.
  const coverage = checkGoldCoverage(matched);
  if (!coverage.ok) {
    result.rejected = matched.length;
    result.reason = `coverage-floor: ${coverage.reason}`;
    trace("data-refresh.gold.floor.rejected", result);
    return result;
  }

  // Guard 2: volatility. See checkGoldVolatility for the exact rule and its
  // first-run behaviour.
  const stored = await withDbRetry(() => repo.readGoldCosts({ game }));
  const volatility = checkGoldVolatility(matched, goldBaseline(stored));
  if (!volatility.ok) {
    result.rejected = matched.length;
    result.reason = `volatility: ${volatility.reason}`;
    result.compared = volatility.compared;
    result.changed = volatility.changed;
    result.bigMoves = volatility.bigMoves;
    result.examples = volatility.examples;
    trace("data-refresh.gold.volatility.rejected", result);
    return result;
  }
  result.compared = volatility.compared;
  result.changed = volatility.changed;
  result.bigMoves = volatility.bigMoves;

  const rows = matched.map(([itemKey, displayName, goldPerUnit]) => ({
    itemKey,
    displayName,
    goldPerUnit,
    source: GOLD_SOURCE_URL,
  }));
  result.written = await withDbRetry(() => repo.upsertGoldCosts(rows, { game, now }));
  resetGoldOverridesCache(game);
  trace("data-refresh.gold.end", result);
  return result;
}

/**
 * Every enabled game's layout, then every enabled game's gold.
 *
 * Sequential on purpose: the games share the instance's single pooled connection
 * and the upstream fetches are polite. Each task is isolated — one game's layout
 * failure cannot fail its gold, the other game, or the route.
 */
export async function runDataRefresh({
  now = Date.now(),
  trace = noop,
  config = loadConfig(),
  fetchImpl = fetch,
  ...options
} = {}) {
  const results = [];
  const games = gameConfigs(config).filter((entry) => entry.enabled);
  // Shared for the whole run: PoE2's layout and gold live on one page.
  const sharedFetch = cachingFetch(fetchImpl);
  const run = async (task, fn, game) => {
    try {
      results.push(await fn({ game: game.id, config, now, trace, fetchImpl: sharedFetch, ...options }));
    } catch (error) {
      const failed = {
        ...emptyResult(game.id, task),
        reason: "threw",
        error: error?.message ?? String(error),
        errorCode: error?.code ?? null,
      };
      trace(`data-refresh.${task}.error`, failed);
      results.push(failed);
    }
  };
  for (const game of games) await run("layout", refreshExchangeLayout, game);
  for (const game of games) await run("gold", refreshGoldCosts, game);
  return results;
}
