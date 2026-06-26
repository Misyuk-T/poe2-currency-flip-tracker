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
import { createGoldRegistry } from "../../../src/domain/gold-costs.js";
import { POE2_GOLD_COSTS } from "../../../src/data/gold-costs-poe2.js";
import { createRadarRepository } from "../../../src/storage/radar-repository.js";
import { buildRadarPayload, buildHistoryPayload, buildHotlistPayload } from "../../../src/server/radar-core.js";
import { ingestFixtures, ingestLive } from "../../../src/server/radar-ingest.js";
import { createGggCxapiProvider } from "../../../src/providers/ggg-cxapi-provider.js";
import { getSql } from "./db.js";

const NO_DB = {
  status: 503,
  body: { error: { code: "no-database", message: "Market storage is not configured." } },
};

let contextPromise;
function context() {
  if (!contextPromise) {
    contextPromise = (async () => {
      const config = loadConfig();
      const goldRegistry = createGoldRegistry(POE2_GOLD_COSTS, { game: config.poeGame });
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

function resolveAnchor(searchParams, config) {
  const requested = searchParams.get("anchor");
  return config.anchors.includes(requested) ? requested : config.anchorCurrency;
}

const sourceMode = (config) => (config.providerMode === "live" ? "official" : "fixture");

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
  const { config, catalogManifest, catalogById, names, scope } = await context();
  const repo = repository(scope);
  if (!repo) return NO_DB;
  const anchor = resolveAnchor(searchParams, config);
  const body = await buildRadarPayload({
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
  });
  // Send only tradable rows over the wire; the no-trade catalog placeholders are
  // the bulk of the payload and no browser consumer renders them.
  body.rows = tradableRows(body.rows);
  return { status: 200, body };
}

export async function getHistory(searchParams) {
  const { config, scope } = await context();
  // Validate input before touching infrastructure so a malformed pair is a clean
  // 400 regardless of database availability.
  const pair = searchParams.get("pair") ?? "";
  if (!/^[\p{L}\p{N}-]+\|[\p{L}\p{N}-]+$/u.test(pair)) {
    return { status: 400, body: { error: { code: "invalid-pair", message: "invalid market pair" } } };
  }
  const repo = repository(scope);
  if (!repo) return NO_DB;
  const anchor = resolveAnchor(searchParams, config);
  const body = await buildHistoryPayload({ repo, pair, anchor });
  return { status: 200, body };
}

export async function getHotlist() {
  const { config, names, scope } = await context();
  const repo = repository(scope);
  if (!repo) return NO_DB;
  const body = await buildHotlistPayload({
    repo,
    anchors: config.anchors,
    shortlist: config.shortlist,
    names,
    radarMaxHotTargets: config.radarMaxHotTargets,
    now: Date.now(),
  });
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
  const { config, scope } = await context();
  const repo = repository(scope);
  if (!repo) return NO_DB;
  if (config.providerMode === "live") {
    const provider = createGggCxapiProvider(config);
    const catchingUp = (await repo.readCxapiState()).cursor != null || config.cxapiStartId != null;
    const summary = await ingestLive({
      repo,
      provider,
      league: config.league,
      startId: config.cxapiStartId,
      // Cap per-invocation backfill so one cron run stays well under the function
      // timeout; the cursor persists, so catch-up continues on the next run.
      maxDigests: catchingUp ? Math.min(config.cxapiMaxBackfillHours, 12) : 1,
    });
    return { status: 200, body: summary };
  }
  const summary = await ingestFixtures({ repo, league: config.league, anchors: config.anchors, now });
  return { status: 200, body: summary };
}

export async function getStatus() {
  const { config, scope } = await context();
  const repo = repository(scope);
  const base = { providerMode: config.providerMode, league: config.league, sourceMode: sourceMode(config) };
  if (!repo) return { status: 200, body: { ...base, radar: { configured: false, reason: "no-database" } } };
  const [state, candles] = await Promise.all([repo.readCxapiState(), repo.readCandleWindow()]);
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
