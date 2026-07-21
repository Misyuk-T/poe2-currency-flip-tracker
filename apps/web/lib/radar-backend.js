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
import { identityNames } from "../../../src/domain/cx-identity.js";
import { createGoldRegistry, createFlatGoldRegistry } from "../../../src/domain/gold-costs.js";
import { POE2_GOLD_COSTS } from "../../../src/data/gold-costs-poe2.js";
import { createRadarRepository } from "../../../src/storage/radar-repository.js";
import { buildRadarPayload, buildHistoryPayload, buildHotlistPayload } from "../../../src/server/radar-core.js";
import { CORE_CURRENCY_IDS, ingestFixtures, ingestFixtureIncrement, ingestLiveStreams } from "../../../src/server/radar-ingest.js";
import { createCxapiProvider } from "../../../src/providers/create-cxapi-provider.js";
import { getSql, resetSql, withDbRetry } from "./db.js";
import { createMemoryRepository } from "./memory-repo.js";

const NO_DB = {
  status: 503,
  body: { error: { code: "no-database", message: "Market storage is not configured." } },
};

const CORE_NAMES = { chaos: "Chaos Orb", divine: "Divine Orb", exalted: "Exalted Orb" };
const CORE_TO_METADATA = Object.fromEntries(Object.entries(CORE_CURRENCY_IDS).map(([metadata, id]) => [id, metadata]));

function remapObjectKeys(value, translate) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [translate(key), item]));
}

function canonicalizePoe1Candle(candle) {
  const translate = (id) => CORE_CURRENCY_IDS[id] ?? id;
  const base = translate(candle.base);
  const quote = translate(candle.quote);
  return {
    ...candle,
    base,
    quote,
    pairId: `${base}|${quote}`,
    volume: remapObjectKeys(candle.volume, translate),
    ...(candle.stock
      ? {
          stock: {
            ...candle.stock,
            lowest: remapObjectKeys(candle.stock.lowest, translate),
            highest: remapObjectKeys(candle.stock.highest, translate),
          },
        }
      : {}),
  };
}

function dedupeCandles(candles) {
  return [...new Map(candles.map((candle) => [`${candle.pairId}|${candle.completedHour}`, candle])).values()];
}

/** Read both legacy Metadata-id rows and newly canonicalized PoE 1 rows. */
export function gameAwareRepository(repo, game) {
  if (!repo || game !== "poe1") return repo;
  return {
    ...repo,
    async readCandleWindow() {
      return dedupeCandles((await repo.readCandleWindow()).map(canonicalizePoe1Candle));
    },
    async readPairCandles(pairId) {
      const legacyPair = pairId.split("|").map((id) => CORE_TO_METADATA[id] ?? id).join("|");
      const variants = legacyPair === pairId ? [pairId] : [legacyPair, pairId];
      const batches = await Promise.all(variants.map((variant) => repo.readPairCandles(variant)));
      return dedupeCandles(batches.flat().map(canonicalizePoe1Candle))
        .sort((a, b) => a.completedHour - b.completedHour);
    },
  };
}

/** Public read scopes. Ingestion streams decide whether a game is actually live. */
export function gameConfigs(config) {
  const streams = new Map((config.cxapiStreams ?? []).map((stream) => [stream.game, stream]));
  const definition = (id, label, fallbackRealm, activeLeague, leagues) => ({
    id,
    label,
    realm: streams.get(id)?.realm ?? fallbackRealm,
    enabled: streams.has(id),
    activeLeague,
    leagues: [...new Set(leagues ?? [])],
  });
  return [
    definition("poe2", "Path of Exile 2", "poe2", config.league, config.leagues),
    definition("poe1", "Path of Exile", "poe1", config.poe1League, config.poe1Leagues),
  ];
}

export function resolveGame(searchParams, config) {
  const requested = searchParams.get("game") ?? config.poeGame ?? "poe2";
  const game = gameConfigs(config).find((entry) => entry.id === requested && entry.enabled);
  if (!game) {
    return {
      error: {
        status: 400,
        body: { error: { code: "invalid-game", message: "unsupported game" } },
      },
    };
  }
  return { game };
}

let contextPromise;
function context() {
  if (!contextPromise) {
    contextPromise = (async () => {
      const config = loadConfig();
      // DEMO PLACEHOLDER: fixture mode can use a uniform flat gold cost so the
      // full synthetic catalog renders. Live mode defaults to the canonical,
      // verified POE2_GOLD_COSTS table and leaves unknowns unrankable.
      // Synthetic fixtures may use a uniform demo cost so every catalog row can
      // render. Official/live reads must never rank markets with invented gold:
      // fall back to the verified POE2_GOLD_COSTS registry unless explicitly
      // overridden for a controlled demo.
      const placeholderRaw =
        process.env.GOLD_PLACEHOLDER_PER_UNIT ?? (config.providerMode === "fixture" ? "600" : "off");
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
        // Catalog names (short-id keys) + identity names (Metadata keys) so both
        // canonical namespaces render a real name; keys don't overlap.
        names: { ...identityNames(), ...nameMapFromCatalog(catalog) },
        scope: { game: config.poeGame, realm: config.poeRealm, league: config.league, mode: config.providerMode },
      };
    })();
  }
  return contextPromise;
}

const noop = () => {};

function repository(scope, { trace = noop } = {}) {
  const sql = getSql();
  return sql
    ? createRadarRepository({
        sql,
        scope,
        onPhase: trace,
        onTimeout: ({ label, ms }) => {
          trace("db.client.reset", { label, timeoutMs: ms });
          return resetSql({ timeout: 0 });
        },
      })
    : null;
}

// Offline fixture fallback: when there's no database AND we're in fixture mode,
// serve a full synthetic radar from an in-memory repository instead of a 503.
// Enabled in local dev automatically; behind RADAR_FIXTURE_FALLBACK=1 elsewhere
// so a real production database outage still degrades to an honest 503 rather
// than masking it with synthetic data.
const fixtureFallbackEnabled = () =>
  process.env.NODE_ENV === "development" || process.env.RADAR_FIXTURE_FALLBACK === "1";

const fixtureRepoPromises = new Map();
function fixtureRepository(ctx, scope = ctx.scope) {
  const key = `${scope.game}|${scope.realm}|${scope.league}|${scope.mode}`;
  if (!fixtureRepoPromises.has(key)) {
    fixtureRepoPromises.set(
      key,
      (async () => {
        const repo = createMemoryRepository(scope);
        // Seed the whole catalog (not just featured markets) so the offline radar
        // mirrors the old backend's "all currencies" mock set.
        await ingestFixtures({
          repo,
          league: scope.league,
          anchors: ctx.config.anchors,
          items: ctx.catalogManifest,
          now: Date.now(),
        });
        return repo;
      })(),
    );
  }
  return fixtureRepoPromises.get(key);
}

/** Postgres repo when DATABASE_URL is set; else the offline fixture repo (dev). */
async function resolveRepo(ctx, scope = ctx.scope) {
  const dbRepo = repository(scope);
  if (dbRepo) return dbRepo;
  if (ctx.config.providerMode === "fixture" && fixtureFallbackEnabled()) return fixtureRepository(ctx, scope);
  return null;
}

function resolveAnchor(searchParams, config) {
  const requested = searchParams.get("anchor");
  return config.anchors.includes(requested) ? requested : config.anchorCurrency;
}

/** Resolve a public read league without allowing arbitrary cache/query scopes. */
export function resolveLeague(searchParams, config) {
  const requested = searchParams.get("league");
  if (!requested) return { league: config.activeLeague ?? config.league };
  if (!config.leagues.includes(requested)) {
    return {
      error: {
        status: 400,
        body: { error: { code: "invalid-league", message: "unsupported league" } },
      },
    };
  }
  return { league: requested };
}

function scopeFor(ctx, game, league, mode = ctx.config.providerMode) {
  return { game: game.id, realm: game.realm, league, mode };
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
  const ctx = await context();
  const { config, catalogManifest, catalogById, names } = ctx;
  const selectedGame = resolveGame(searchParams, config);
  if (selectedGame.error) return selectedGame.error;
  const { game } = selectedGame;
  const selected = resolveLeague(searchParams, game);
  if (selected.error) return selected.error;
  const repo = gameAwareRepository(await resolveRepo(ctx, scopeFor(ctx, game, selected.league)), game.id);
  if (!repo) return NO_DB;
  const anchor = resolveAnchor(searchParams, config);
  const isPoe2 = game.id === "poe2";
  const body = await withDbRetry(() =>
    buildRadarPayload({
      repo,
      anchor,
      anchors: config.anchors,
      shortlist: config.shortlist,
      names: isPoe2 ? names : CORE_NAMES,
      catalogManifest: isPoe2 ? catalogManifest : [],
      catalogById: isPoe2 ? catalogById : new Map(),
      source: { sourceMode: sourceMode(config), providerMode: config.providerMode },
      radarMaxHotTargets: config.radarMaxHotTargets,
      now: Date.now(),
    }),
  );
  // Send only tradable rows over the wire; the no-trade catalog placeholders are
  // the bulk of the payload and no browser consumer renders them.
  body.rows = tradableRows(body.rows);
  body.league = selected.league;
  body.game = game.id;
  body.realm = game.realm;
  return { status: 200, body };
}

export async function getHistory(searchParams) {
  const ctx = await context();
  const { config } = ctx;
  // Validate input before touching infrastructure so a malformed pair is a clean
  // 400 regardless of database availability.
  const pair = searchParams.get("pair") ?? "";
  // Two canonical ids joined by "|". An id is a catalog short id (letters/digits/
  // hyphen) OR — for the unmapped long tail — a Metadata path (adds "/"). Bounded
  // length; the value is only ever used as a parameterized SQL literal downstream.
  if (!/^[\p{L}\p{N}\-/]{1,128}\|[\p{L}\p{N}\-/]{1,128}$/u.test(pair)) {
    return { status: 400, body: { error: { code: "invalid-pair", message: "invalid market pair" } } };
  }
  const selectedGame = resolveGame(searchParams, config);
  if (selectedGame.error) return selectedGame.error;
  const { game } = selectedGame;
  const selected = resolveLeague(searchParams, game);
  if (selected.error) return selected.error;
  const repo = gameAwareRepository(await resolveRepo(ctx, scopeFor(ctx, game, selected.league)), game.id);
  if (!repo) return NO_DB;
  const anchor = resolveAnchor(searchParams, config);
  const body = await withDbRetry(() => buildHistoryPayload({ repo, pair, anchor }));
  body.league = selected.league;
  body.game = game.id;
  return { status: 200, body };
}

export async function getHotlist(searchParams = new URLSearchParams()) {
  const ctx = await context();
  const { config, names } = ctx;
  const selectedGame = resolveGame(searchParams, config);
  if (selectedGame.error) return selectedGame.error;
  const { game } = selectedGame;
  const selected = resolveLeague(searchParams, game);
  if (selected.error) return selected.error;
  const repo = gameAwareRepository(await resolveRepo(ctx, scopeFor(ctx, game, selected.league)), game.id);
  if (!repo) return NO_DB;
  const body = await withDbRetry(() =>
    buildHotlistPayload({
      repo,
      anchors: config.anchors,
      shortlist: config.shortlist,
      names: game.id === "poe2" ? names : CORE_NAMES,
      radarMaxHotTargets: config.radarMaxHotTargets,
      now: Date.now(),
    }),
  );
  body.league = selected.league;
  body.game = game.id;
  return { status: 200, body };
}

export async function getConfig() {
  const { config } = await context();
  const games = gameConfigs(config).map((game) => ({
    ...game,
    reason: game.enabled ? null : "Market stream is not configured",
    leagues: game.leagues.map((league) => ({ id: league, label: league, enabled: true })),
  }));
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
      ingestProviderMode: config.ingestProviderMode,
      games,
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
export async function runRadarIngest({ now = Date.now(), trace = noop } = {}) {
  trace("context.start");
  const { config, scope, catalogManifest } = await context();
  trace("context.end", {
    readMode: config.providerMode,
    ingestMode: config.ingestProviderMode,
    catalogItems: catalogManifest.length,
  });
  const ingestScope = { ...scope, mode: config.ingestProviderMode };
  const repo = repository(ingestScope, { trace });
  if (!repo) return NO_DB;
  if (config.ingestProviderMode === "live") {
    // One CDN stream per configured (game, realm), carrying the active league and
    // its own per-(game,realm) cursor. Streams run serially under a
    // shared wall-clock budget (cxapiIngestBudgetMs) so one invocation always
    // returns under the 60s function/pg_net limit; cursors persist, so catch-up
    // spills into the next cron run.
    const streams = await ingestLiveStreams({
      streams: config.cxapiStreams,
      config,
      now,
      makeRepo: (streamScope) => repository(streamScope, { trace }),
      makeProvider: createCxapiProvider,
      budgetMs: config.cxapiIngestBudgetMs,
      trace,
    });
    return { status: 200, body: { mode: "live", streams } };
  }
  // Production cron is incremental. The offline in-memory fallback above still
  // seeds full history once, but a deployed invocation writes only one digest.
  const summary = await ingestFixtureIncrement({
    repo,
    league: config.league,
    anchors: config.anchors,
    items: catalogManifest,
    now,
    trace,
  });
  return { status: 200, body: summary };
}

export async function getStatus() {
  const ctx = await context();
  const { config } = ctx;
  const repo = await resolveRepo(ctx);
  const base = {
    providerMode: config.providerMode,
    ingestProviderMode: config.ingestProviderMode,
    league: config.league,
    sourceMode: sourceMode(config),
  };
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
