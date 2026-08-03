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
import {
  identityCategories,
  identityIcons,
  identityNames,
} from "../../../src/domain/cx-identity.js";
import { applyExchangeLayout, exchangeLayoutCategories } from "../../../src/domain/exchange-layout.js";
import { createGoldRegistry, createFlatGoldRegistry } from "../../../src/domain/gold-costs.js";
import { canonicalPairId, isPublicLeague } from "../../../src/domain/cx-market.js";
import { selectAutomaticAnchors } from "../../../src/domain/market-anchor.js";
import { RADAR_PAYLOAD_VERSION, isCompatibleRadarSnapshot } from "../../../src/domain/radar-snapshot.js";
import { POE2_GOLD_COSTS } from "../../../src/data/gold-costs-poe2.js";
import { createRadarRepository } from "../../../src/storage/radar-repository.js";
import {
  buildRadarPayloads,
  buildHistoryPayload,
  buildHotlistPayload,
  mergeRadarPayloads,
} from "../../../src/server/radar-core.js";
import { CORE_CURRENCY_IDS, ingestFixtures, ingestFixtureIncrement, ingestLiveStreams, translatorForGame } from "../../../src/server/radar-ingest.js";
import { createCxapiProvider } from "../../../src/providers/create-cxapi-provider.js";
import { getSql, resetSql, withDbRetry } from "./db.js";
import { createMemoryRepository } from "./memory-repo.js";

const NO_DB = {
  status: 503,
  body: { error: { code: "no-database", message: "Market storage is not configured." } },
};

const CORE_NAMES = { chaos: "Chaos Orb", divine: "Divine Orb", exalted: "Exalted Orb", alchemy: "Orb of Alchemy" };
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
    pairId: canonicalPairId(base, quote),
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
      const currentParts = pairId.split("|");
      const legacyParts = currentParts.map((id) => CORE_TO_METADATA[id] ?? id);
      const variants = [...new Set([
        canonicalPairId(...currentParts),
        currentParts.join("|"),
        currentParts.slice().reverse().join("|"),
        canonicalPairId(...legacyParts),
        legacyParts.join("|"),
        legacyParts.slice().reverse().join("|"),
      ])];
      const batches = await Promise.all(variants.map((variant) => repo.readPairCandles(variant)));
      return dedupeCandles(batches.flat().map(canonicalizePoe1Candle))
        .sort((a, b) => a.completedHour - b.completedHour);
    },
  };
}

/** Public read scopes. Ingestion streams decide whether a game is actually live. */
export function gameConfigs(config) {
  const streams = new Map((config.cxapiStreams ?? []).map((stream) => [stream.game, stream]));
  const definition = (id, label, fallbackRealm, activeLeague, leagues, anchorCurrency, anchors) => ({
    id,
    label,
    realm: streams.get(id)?.realm ?? fallbackRealm,
    enabled: streams.has(id),
    activeLeague,
    leagues: [...new Set(leagues ?? [])],
    anchorCurrency,
    anchors: [...new Set(anchors ?? [anchorCurrency])],
  });
  return [
    definition("poe2", "Path of Exile 2", "poe2", config.league, config.leagues, config.anchorCurrency, config.anchors),
    definition("poe1", "Path of Exile", "poe1", config.poe1League, config.poe1Leagues, "chaos", ["chaos", "divine", "exalted", "alchemy"]),
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
      const poe1MetadataIcons = identityIcons("poe1");
      const poe1MetadataCategories = identityCategories("poe1");
      const poe1CoreIcons = Object.fromEntries(
        Object.entries(CORE_TO_METADATA)
          .map(([id, metadata]) => [id, poe1MetadataIcons[metadata]])
          .filter(([, icon]) => icon),
      );
      const poe1CoreCategories = Object.fromEntries(
        Object.entries(CORE_TO_METADATA)
          .map(([id, metadata]) => [id, poe1MetadataCategories[metadata]])
          .filter(([, category]) => category),
      );
      const poe1Identity = {
        names: { ...identityNames("poe1"), ...CORE_NAMES },
        icons: { ...poe1MetadataIcons, ...poe1CoreIcons },
        categories: { ...poe1MetadataCategories, ...poe1CoreCategories },
      };
      const poe2Identity = {
        names: { ...identityNames("poe2"), ...nameMapFromCatalog(catalog) },
        icons: identityIcons("poe2"),
        categories: identityCategories("poe2"),
      };
      return {
        config,
        catalogManifest: manifest,
        catalogById: new Map(manifest.map((item) => [item.id, item])),
        identityByGame: { poe1: poe1Identity, poe2: poe2Identity },
        scope: { game: config.poeGame, realm: config.poeRealm, league: config.league, mode: config.providerMode },
      };
    })();
  }
  return contextPromise;
}

const noop = () => {};

function repository(scope, { trace = noop, anchors = [] } = {}) {
  const sql = getSql();
  const storedAnchors = scope.game === "poe1"
    ? [...new Set(anchors.flatMap((anchor) => [anchor, CORE_TO_METADATA[anchor]].filter(Boolean)))]
    : anchors;
  return sql
    ? createRadarRepository({
        sql,
        scope,
        anchors: storedAnchors,
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
          anchors: gameConfigs(ctx.config).find((game) => game.id === scope.game)?.anchors ?? ctx.config.anchors,
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
async function resolveRepo(ctx, scope = ctx.scope, resolvedAnchors = null) {
  const anchors = resolvedAnchors
    ?? gameConfigs(ctx.config).find((game) => game.id === scope.game)?.anchors
    ?? [];
  const dbRepo = repository(scope, { anchors });
  if (dbRepo) return dbRepo;
  if (ctx.config.providerMode === "fixture" && fixtureFallbackEnabled()) return fixtureRepository(ctx, scope);
  return null;
}

function resolveAnchor(searchParams, config) {
  const requested = searchParams.get("anchor");
  return config.anchors.includes(requested) ? requested : config.anchorCurrency;
}

function normalizeAnchorCandidates(candidates, game) {
  const translate = translatorForGame(game.id);
  const combined = new Map();
  for (const candidate of candidates ?? []) {
    const currency = translate(candidate.currency);
    if (!currency) continue;
    const current = combined.get(currency) ?? { currency, pairCount: 0, sampleCount: 0 };
    current.pairCount += Number(candidate.pairCount) || 0;
    current.sampleCount += Number(candidate.sampleCount) || 0;
    combined.set(currency, current);
  }
  return [...combined.values()];
}

async function automaticAnchorPlan(repo, game, previousAnchor = null) {
  const candidates = repo?.listAnchorCandidates
    ? normalizeAnchorCandidates(await withDbRetry(() => repo.listAnchorCandidates()), game)
    : [];
  return selectAutomaticAnchors(candidates, {
    fallbackAnchors: game.anchors,
    previousAnchor,
    maxAnchors: 5,
  });
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

/** Configured leagues are immediate; a new public league needs recent DB data. */
export async function resolveLeagueAccess(searchParams, config, hasRecentData = async () => false) {
  const configured = resolveLeague(searchParams, config);
  if (!configured.error) return configured;
  const requested = searchParams.get("league");
  if (isPublicLeague(requested) && await hasRecentData(requested)) return { league: requested };
  return configured;
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

function radarBuildInput(ctx, game, repo, now = Date.now(), anchors = game.anchors) {
  const isPoe2 = game.id === "poe2";
  const identity = ctx.identityByGame[game.id] ?? { names: CORE_NAMES, icons: {}, categories: {} };
  return {
    repo,
    anchors,
    shortlist: ctx.config.shortlist,
    names: identity.names,
    icons: identity.icons,
    categories: identity.categories,
    canonicalId: translatorForGame(game.id),
    catalogManifest: isPoe2 ? ctx.catalogManifest : [],
    catalogById: isPoe2 ? ctx.catalogById : new Map(),
    source: { sourceMode: sourceMode(ctx.config), providerMode: ctx.config.providerMode },
    radarMaxHotTargets: ctx.config.radarMaxHotTargets,
    now,
  };
}

function finalizeRadarBody(body, game, league) {
  body.rows = applyExchangeLayout(tradableRows(body.rows), game.id);
  body.payloadVersion = RADAR_PAYLOAD_VERSION;
  body.league = league;
  body.game = game.id;
  body.realm = game.realm;
  body.exchangeLayout = {
    source: "game-client-layout",
    categories: exchangeLayoutCategories(game.id),
  };
  return body;
}

export async function getRadar(searchParams) {
  const ctx = await context();
  const { config } = ctx;
  const selectedGame = resolveGame(searchParams, config);
  if (selectedGame.error) return selectedGame.error;
  const { game } = selectedGame;
  const selected = await resolveLeagueAccess(searchParams, game, async (requestedLeague) => {
    const candidate = repository(scopeFor(ctx, game, requestedLeague), { anchors: game.anchors });
    return candidate ? withDbRetry(() => candidate.hasPricedCandles()) : false;
  });
  if (selected.error) return selected.error;
  const scope = scopeFor(ctx, game, selected.league);
  const discoveryRepo = gameAwareRepository(await resolveRepo(ctx, scope), game.id);
  if (!discoveryRepo) return NO_DB;
  const autoView = searchParams.get("anchor") === "auto";
  const anchor = resolveAnchor(searchParams, game);
  const bestView = autoView || searchParams.get("view") === "best";
  if (autoView && discoveryRepo.readRadarSnapshot) {
    const autoSnapshot = await withDbRetry(() => discoveryRepo.readRadarSnapshot("auto"));
    if (isCompatibleRadarSnapshot(autoSnapshot)) return { status: 200, body: autoSnapshot.payload };
  }
  const previousAuto = autoView && discoveryRepo.readRadarSnapshot
    ? await withDbRetry(() => discoveryRepo.readRadarSnapshot("auto"))
    : null;
  const anchorPlan = autoView
    ? await automaticAnchorPlan(discoveryRepo, game, previousAuto?.payload?.anchor ?? game.anchorCurrency)
    : { primary: anchor, anchors: game.anchors };
  const requestedAnchor = autoView ? anchorPlan.primary : anchor;
  const requestedAnchors = bestView ? anchorPlan.anchors : [requestedAnchor];
  const repo = gameAwareRepository(await resolveRepo(ctx, scope, requestedAnchors), game.id);
  if (!repo) return NO_DB;
  const snapshots = repo.readRadarSnapshot
    ? await Promise.all(requestedAnchors.map(async (snapshotAnchor) => [
        snapshotAnchor,
        await withDbRetry(() => repo.readRadarSnapshot(snapshotAnchor)),
      ]))
    : [];
  const freshPayloads = Object.fromEntries(snapshots
    .filter(([, snapshot]) => isCompatibleRadarSnapshot(snapshot))
    .map(([snapshotAnchor, snapshot]) => [snapshotAnchor, snapshot.payload]));
  if (Object.keys(freshPayloads).length === requestedAnchors.length) {
    return {
      status: 200,
      body: bestView
        ? mergeRadarPayloads(freshPayloads, { preferredAnchor: requestedAnchor })
        : freshPayloads[requestedAnchor],
    };
  }

  // Backward-compatible/self-healing fallback for the first request after the
  // migration or if the hourly snapshot refresh failed. It is deliberately not
  // the normal path anymore.
  const built = await withDbRetry(() => buildRadarPayloads(radarBuildInput(ctx, game, repo, Date.now(), requestedAnchors)));
  const payloads = Object.fromEntries(Object.entries(built).map(([payloadAnchor, payload]) => [
    payloadAnchor,
    finalizeRadarBody(payload, game, selected.league),
  ]));
  const body = bestView
    ? mergeRadarPayloads(payloads, { preferredAnchor: requestedAnchor })
    : payloads[requestedAnchor];
  if (repo.writeRadarSnapshots) {
    try {
      const snapshotWrites = Object.entries(payloads).map(([payloadAnchor, payload]) => ({
        anchor: payloadAnchor,
        payload,
      }));
      if (autoView) snapshotWrites.push({ anchor: "auto", payload: body });
      await withDbRetry(() => repo.writeRadarSnapshots(snapshotWrites));
    } catch (error) {
      console.error("[radar-snapshot] on-demand upsert failed", {
        game: game.id,
        league: selected.league,
        anchor: autoView ? "auto" : bestView ? "best" : anchor,
        error: error?.message ?? String(error),
      });
    }
  }
  return { status: 200, body };
}

async function refreshRadarSnapshots(ctx, { now = Date.now(), trace = noop } = {}) {
  const results = [];
  for (const game of gameConfigs(ctx.config)) {
    if (!game.enabled) continue;
    // Rebuild the two default landing scopes hourly. Alternate leagues keep
    // their stored snapshot and self-refresh on first use after the six-hour
    // freshness window. Rebuilding every selector option transferred tens of
    // millions of raw candle rows from Supabase even when nobody viewed them.
    for (const league of [game.activeLeague]) {
      const startedAt = Date.now();
      trace("snapshot.scope.start", { game: game.id, league });
      try {
        const discoveryRepo = gameAwareRepository(
          repository(scopeFor(ctx, game, league), { trace, anchors: game.anchors }),
          game.id,
        );
        if (!discoveryRepo || !(await withDbRetry(() => discoveryRepo.hasPricedCandles()))) {
          results.push({ game: game.id, league, skipped: "no-data" });
          trace("snapshot.scope.end", { game: game.id, league, skipped: "no-data" });
          continue;
        }
        const previousAuto = discoveryRepo.readRadarSnapshot
          ? await withDbRetry(() => discoveryRepo.readRadarSnapshot("auto"))
          : null;
        const anchorPlan = await automaticAnchorPlan(
          discoveryRepo,
          game,
          previousAuto?.payload?.anchor ?? game.anchorCurrency,
        );
        const repo = gameAwareRepository(
          repository(scopeFor(ctx, game, league), { trace, anchors: anchorPlan.anchors }),
          game.id,
        );
        const payloads = await withDbRetry(() =>
          buildRadarPayloads(radarBuildInput(ctx, game, repo, now, anchorPlan.anchors)),
        );
        const snapshots = Object.entries(payloads).map(([anchor, payload]) => ({
          anchor,
          payload: finalizeRadarBody(payload, game, league),
        }));
        snapshots.push({
          anchor: "auto",
          payload: mergeRadarPayloads(
            Object.fromEntries(snapshots.map((snapshot) => [snapshot.anchor, snapshot.payload])),
            { preferredAnchor: anchorPlan.primary },
          ),
        });
        await withDbRetry(() => repo.writeRadarSnapshots(snapshots));
        const result = {
          game: game.id,
          league,
          anchors: snapshots.length,
          rows: snapshots.reduce((count, item) => count + item.payload.rows.length, 0),
          elapsedMs: Date.now() - startedAt,
        };
        results.push(result);
        trace("snapshot.scope.end", result);
      } catch (error) {
        const result = {
          game: game.id,
          league,
          error: error?.message ?? String(error),
          elapsedMs: Date.now() - startedAt,
        };
        results.push(result);
        trace("snapshot.scope.error", result);
      }
    }
  }
  return results;
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
  if (!/^[\p{L}\p{N}_\-/]{1,128}\|[\p{L}\p{N}_\-/]{1,128}$/u.test(pair)) {
    return { status: 400, body: { error: { code: "invalid-pair", message: "invalid market pair" } } };
  }
  const selectedGame = resolveGame(searchParams, config);
  if (selectedGame.error) return selectedGame.error;
  const { game } = selectedGame;
  const selected = await resolveLeagueAccess(searchParams, game, async (requestedLeague) => {
    const candidate = repository(scopeFor(ctx, game, requestedLeague), { anchors: game.anchors });
    return candidate ? withDbRetry(() => candidate.hasPricedCandles()) : false;
  });
  if (selected.error) return selected.error;
  const repo = gameAwareRepository(await resolveRepo(ctx, scopeFor(ctx, game, selected.league)), game.id);
  if (!repo) return NO_DB;
  const requestedAnchor = searchParams.get("anchor");
  const pairCurrencies = pair.split("|");
  const anchor = pairCurrencies.includes(requestedAnchor) ? requestedAnchor : resolveAnchor(searchParams, game);
  const body = await withDbRetry(() => buildHistoryPayload({ repo, pair, anchor }));
  body.league = selected.league;
  body.game = game.id;
  return { status: 200, body };
}

export async function getHotlist(searchParams = new URLSearchParams()) {
  const ctx = await context();
  const { config, identityByGame } = ctx;
  const selectedGame = resolveGame(searchParams, config);
  if (selectedGame.error) return selectedGame.error;
  const { game } = selectedGame;
  const selected = await resolveLeagueAccess(searchParams, game, async (requestedLeague) => {
    const candidate = repository(scopeFor(ctx, game, requestedLeague), { anchors: game.anchors });
    return candidate ? withDbRetry(() => candidate.hasPricedCandles()) : false;
  });
  if (selected.error) return selected.error;
  const repo = gameAwareRepository(await resolveRepo(ctx, scopeFor(ctx, game, selected.league)), game.id);
  if (!repo) return NO_DB;
  const body = await withDbRetry(() =>
    buildHotlistPayload({
      repo,
      anchors: game.anchors,
      shortlist: config.shortlist,
      names: identityByGame[game.id]?.names ?? CORE_NAMES,
      radarMaxHotTargets: config.radarMaxHotTargets,
      now: Date.now(),
    }),
  );
  body.league = selected.league;
  body.game = game.id;
  return { status: 200, body };
}

async function leagueAvailability(ctx, games) {
  // Local fixture mode has no database; keep its configured league list intact.
  // In production each EXISTS probe uses the scope/recent index and avoids the
  // expensive full radar computation.
  if (!getSql()) return null;
  const available = new Map();
  const discovered = new Map();
  for (const game of games) {
    if (!game.enabled) continue;
    try {
      const discoveryRepo = repository(scopeFor(ctx, game, game.activeLeague), { anchors: game.anchors });
      const rows = discoveryRepo?.listPricedLeagues
        ? await withDbRetry(() => discoveryRepo.listPricedLeagues())
        : [];
      discovered.set(game.id, rows.map((row) => row.league));
      for (const row of rows) available.set(`${game.id}|${row.league}`, true);
    } catch {
      // Keep configured fallbacks if discovery has a transient DB failure.
      discovered.set(game.id, []);
    }
    for (const league of game.leagues) {
      const key = `${game.id}|${league}`;
      if (available.get(key) === true) continue;
      try {
        const repo = repository(scopeFor(ctx, game, league), { anchors: game.anchors });
        const hasData = repo
          ? await withDbRetry(() => repo.hasPricedCandles())
          : true;
        available.set(key, hasData);
      } catch {
        // A config probe must never hide a valid league because the database had
        // a transient read failure. The radar route will surface a real error.
        available.set(key, true);
      }
    }
  }
  return { available, discovered };
}

export async function getConfig() {
  const ctx = await context();
  const { config } = ctx;
  const definitions = gameConfigs(config);
  const leagueState = await leagueAvailability(ctx, definitions);
  const games = definitions.map((game) => {
    const allLeagues = [...new Set([
      ...game.leagues,
      ...(leagueState?.discovered.get(game.id) ?? []),
    ])];
    const leagues = allLeagues.map((league) => ({
      id: league,
      label: league,
      enabled: leagueState?.available.get(`${game.id}|${league}`) !== false,
    }));
    const enabledLeagueIds = leagues.filter((entry) => entry.enabled).map((entry) => entry.id);
    return {
      ...game,
      activeLeague: enabledLeagueIds.includes(game.activeLeague)
        ? game.activeLeague
        : enabledLeagueIds[0] ?? game.activeLeague,
      reason: game.enabled ? null : "Market stream is not configured",
      leagues,
    };
  });
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
    // One CDN stream per configured (game, realm), carrying every public league and
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
    const snapshots = await refreshRadarSnapshots(await context(), { now, trace });
    return { status: 200, body: { mode: "live", streams, snapshots } };
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
  const snapshots = await refreshRadarSnapshots(await context(), { now, trace });
  return { status: 200, body: { ...summary, snapshots } };
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
