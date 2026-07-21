/**
 * Serverless backend for the Next.js read routes. Builds the static read
 * context once per warm instance (config + catalog manifest + names), opens a
 * per-request Postgres repository, and shapes responses with the shared radar
 * core. Returns { status, body } so each route handler stays a one-liner.
 *
 * There is no always-on process here: no in-memory snapshot, no scheduler, no
 * circuit breaker. Reads are bounded Postgres queries + pure domain transforms.
 */

import { loadConfig } from "../../../src/server/config.js";
import { loadCatalog, buildManifest, nameMapFromCatalog } from "../../../src/domain/catalog.js";
import { createGoldRegistry, createFlatGoldRegistry } from "../../../src/domain/gold-costs.js";
import { POE2_GOLD_COSTS } from "../../../src/data/gold-costs-poe2.js";
import { createRadarRepository } from "../../../src/storage/radar-repository.js";
import { buildRadarPayload, buildHistoryPayload, buildHotlistPayload } from "../../../src/server/radar-core.js";
import { ingestFixtures, ingestLive } from "../../../src/server/radar-ingest.js";
import { createCxapiProvider } from "../../../src/providers/create-cxapi-provider.js";
import { getSql, withDbRetry } from "./db.js";
import { createMemoryRepository } from "./memory-repo.js";

const NO_DB = {
  status: 503,
  body: { error: { code: "no-database", message: "Market storage is not configured." } },
};

let contextPromise;
function context() {
  if (!contextPromise) {
    contextPromise = (async () => {
      const config = loadConfig();
      // DEMO PLACEHOLDER (pre-live): a uniform flat gold cost for every currency
      // so the radar/catalog surface is complete (nothing "unrankable") before we
      // obtain real per-currency gold data. Flat value is honest-by-uniformity and
      // labelled a placeholder. Set GOLD_PLACEHOLDER_PER_UNIT=0 (or "off") to fall
      // back to the canonical verified POE2_GOLD_COSTS table.
      const placeholderRaw = process.env.GOLD_PLACEHOLDER_PER_UNIT ?? "600";
      const placeholderPerUnit = Number(placeholderRaw);
      const usePlaceholder =
        placeholderRaw !== "off" && Number.isFinite(placeholderPerUnit) && placeholderPerUnit > 0;
      const goldRegistry = usePlaceholder
        ? createFlatGoldRegistry({ game: config.poeGame, goldPerUnit: placeholderPerUnit })
        : createGoldRegistry(POE2_GOLD_COSTS, { game: config.poeGame });
      const catalog = await loadCatalog();
      const manifest = buildManifest(catalog, goldRegistry);
      return {
        config,
        catalogManifest: manifest,
        catalogById: new Map(manifest.map((item) => [item.id, item])),
        names: nameMapFromCatalog(catalog),
        scope: { game: config.poeGame, realm: config.poeRealm, league: config.league, mode: config.providerMode },
      };
    })();
  }
  return contextPromise;
}

function repository(scope) {
  const sql = getSql();
  return sql ? createRadarRepository({ sql, scope }) : null;
}

// Offline fixture fallback: when there's no database AND we're in fixture mode,
// serve a full synthetic radar from an in-memory repository instead of a 503.
// Enabled in local dev automatically; behind RADAR_FIXTURE_FALLBACK=1 elsewhere
// so a real production database outage still degrades to an honest 503 rather
// than masking it with synthetic data.
const fixtureFallbackEnabled = () =>
  process.env.NODE_ENV === "development" || process.env.RADAR_FIXTURE_FALLBACK === "1";

let fixtureRepoPromise;
function fixtureRepository(ctx) {
  if (!fixtureRepoPromise) {
    fixtureRepoPromise = (async () => {
      const repo = createMemoryRepository(ctx.scope);
      // Seed the whole catalog (not just featured markets) so the offline radar
      // mirrors the old backend's "all currencies" mock set.
      await ingestFixtures({
        repo,
        league: ctx.config.league,
        anchors: ctx.config.anchors,
        items: ctx.catalogManifest,
        now: Date.now(),
      });
      return repo;
    })();
  }
  return fixtureRepoPromise;
}

/** Postgres repo when DATABASE_URL is set; else the offline fixture repo (dev). */
async function resolveRepo(ctx) {
  const dbRepo = repository(ctx.scope);
  if (dbRepo) return dbRepo;
  if (ctx.config.providerMode === "fixture" && fixtureFallbackEnabled()) return fixtureRepository(ctx);
  return null;
}

function resolveAnchor(searchParams, config) {
  const requested = searchParams.get("anchor");
  return config.anchors.includes(requested) ? requested : config.anchorCurrency;
}

const sourceMode = (config) => (config.providerMode === "live" ? "official" : "fixture");

/** Last completed hour minus a bounded backfill window, in unix seconds. */
function recentStartHour(nowMs, backfillHours) {
  const lastCompleted = Math.floor(nowMs / 3600_000) * 3600 - 3600;
  return lastCompleted - Math.max(1, Math.min(backfillHours, 48)) * 3600;
}

/**
 * Drop no-trade placeholder rows from a radar payload's `rows`. Every browser
 * consumer (dashboard, homepage mini-radar) already filters these out, and they
 * are the bulk of the full catalog — trimming them on the wire saves a lot of
 * bandwidth. The payload's `trackedCount` / `catalogCount` still report the
 * full picture, so nothing honest is lost.
 */
export function tradableRows(rows) {
  return (rows ?? []).filter((row) => row?.pairId && row.status !== "no-trades-this-hour");
}

export async function getRadar(searchParams) {
  const ctx = await context();
  const { config, catalogManifest, catalogById, names } = ctx;
  const repo = await resolveRepo(ctx);
  if (!repo) return NO_DB;
  const anchor = resolveAnchor(searchParams, config);
  const body = await withDbRetry(() =>
    buildRadarPayload({
      repo,
      anchor,
      anchors: config.anchors,
      shortlist: config.shortlist,
      names,
      catalogManifest,
      catalogById,
      source: { sourceMode: sourceMode(config), providerMode: config.providerMode },
      radarMaxHotTargets: config.radarMaxHotTargets,
      now: Date.now(),
    }),
  );
  // Send only tradable rows over the wire; the no-trade catalog placeholders are
  // the bulk of the payload and no browser consumer renders them.
  body.rows = tradableRows(body.rows);
  return { status: 200, body };
}

export async function getHistory(searchParams) {
  const ctx = await context();
  const { config } = ctx;
  // Validate input before touching infrastructure so a malformed pair is a clean
  // 400 regardless of database availability.
  const pair = searchParams.get("pair") ?? "";
  if (!/^[\p{L}\p{N}-]+\|[\p{L}\p{N}-]+$/u.test(pair)) {
    return { status: 400, body: { error: { code: "invalid-pair", message: "invalid market pair" } } };
  }
  const repo = await resolveRepo(ctx);
  if (!repo) return NO_DB;
  const anchor = resolveAnchor(searchParams, config);
  const body = await withDbRetry(() => buildHistoryPayload({ repo, pair, anchor }));
  return { status: 200, body };
}

export async function getHotlist() {
  const ctx = await context();
  const { config, names } = ctx;
  const repo = await resolveRepo(ctx);
  if (!repo) return NO_DB;
  const body = await withDbRetry(() =>
    buildHotlistPayload({
      repo,
      anchors: config.anchors,
      shortlist: config.shortlist,
      names,
      radarMaxHotTargets: config.radarMaxHotTargets,
      now: Date.now(),
    }),
  );
  return { status: 200, body };
}

export async function getConfig() {
  const { config } = await context();
  return {
    status: 200,
    body: {
      league: config.league,
      game: config.poeGame,
      realm: config.poeRealm,
      anchorCurrency: config.anchorCurrency,
      anchors: config.anchors,
      shortlist: config.shortlist,
      providerMode: config.providerMode,
      games: [
        {
          id: "poe2",
          label: "Path of Exile 2",
          realm: config.poeRealm,
          enabled: true,
          activeLeague: config.league,
          leagues: config.leagues.map((l) => ({ id: l, label: l, enabled: l === config.league })),
        },
        { id: "poe1", label: "Path of Exile", enabled: false, reason: "Coming later", leagues: [] },
      ],
      // Server-side opportunities (executable book) is deferred in the serverless
      // build; the radar surface is the product here.
      features: { radar: true, hourlyRadar: true, workingPrice: true, manualPrice: true, liveBooks: false },
    },
  };
}

/**
 * Constant-time check of the cron Authorization header against CRON_SECRET.
 * Returns false when the secret is unset (caller should treat that as disabled).
 */
export function isCronAuthorized(authHeader) {
  const secret = process.env.CRON_SECRET;
  if (!secret || typeof authHeader !== "string") return false;
  const expected = `Bearer ${secret}`;
  if (authHeader.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= authHeader.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export const cronConfigured = () => Boolean(process.env.CRON_SECRET);

/** Ingest the latest hourly market data (fixture synth or live cxapi catch-up). */
export async function runRadarIngest({ now = Date.now() } = {}) {
  const { config, scope, catalogManifest } = await context();
  const repo = repository(scope);
  if (!repo) return NO_DB;
  if (config.providerMode === "live") {
    const provider = createCxapiProvider(config);
    const cursor = (await repo.readCxapiState()).cursor;
    // The CDN's no-id endpoint returns the FIRST hour of ALL history (Dec 2024),
    // so a fresh DB with no cursor and no configured start id would crawl the
    // entire archive. Default CDN live to a recent backfill window instead, so
    // activation is safe even without CXAPI_START_ID. (The OAuth feed's no-id is
    // "latest", so it needs no such default.)
    const startId =
      config.cxapiStartId ??
      (config.cxapiSource === "cdn" && cursor == null ? recentStartHour(now, config.cxapiMaxBackfillHours) : null);
    const catchingUp = cursor != null || startId != null;
    const summary = await ingestLive({
      repo,
      provider,
      league: config.league,
      startId,
      // Cap per-invocation backfill so one cron run stays well under the function
      // timeout; the cursor persists, so catch-up continues on the next run.
      maxDigests: catchingUp ? Math.min(config.cxapiMaxBackfillHours, 12) : 1,
    });
    return { status: 200, body: summary };
  }
  // Seed the whole catalog (not just featured markets) so the deployed radar
  // mirrors the offline/local fixture's "all currencies" set. Idempotent, so the
  // first run backfills every pair and later hourly runs just add the new hour.
  const summary = await ingestFixtures({
    repo,
    league: config.league,
    anchors: config.anchors,
    items: catalogManifest,
    now,
  });
  return { status: 200, body: summary };
}

export async function getStatus() {
  const ctx = await context();
  const { config } = ctx;
  const repo = await resolveRepo(ctx);
  const base = { providerMode: config.providerMode, league: config.league, sourceMode: sourceMode(config) };
  if (!repo) return { status: 200, body: { ...base, radar: { configured: false, reason: "no-database" } } };
  const [state, candles] = await withDbRetry(() =>
    Promise.all([repo.readCxapiState(), repo.readCandleWindow()]),
  );
  const pairs = new Set(candles.map((c) => c.pairId));
  const latestHour = candles.reduce((max, c) => Math.max(max, c.completedHour), 0);
  return {
    status: 200,
    body: {
      ...base,
      radar: {
        configured: true,
        cursorPresent: state.cursor != null,
        lastDigestId: state.lastDigestId,
        pairCount: pairs.size,
        candleCount: candles.length,
        latestCompletedHour: latestHour ? new Date(latestHour).toISOString() : null,
        ingestionLagMs: latestHour ? Date.now() - latestHour : null,
      },
    },
  };
}
