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
import { chooseDefaultLeague } from "../../../src/domain/league-default.js";
import { getSql, resetSql, withDbRetry } from "./db.js";
import { readLeagueMetaCached, resetLeagueMetaCache, resolveDefaultLeague } from "./default-league.js";
import {
  loadIdentityOverrides,
  peekIdentityOverrides,
  readIdentityOverridesCached,
} from "./identity-overrides.js";
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

/**
 * One gameConfigs entry with `activeLeague` replaced by the RESOLVED default
 * league (env override > league_meta.is_default > code fallback), plus the
 * `defaultLeagueSource` that produced it. The resolved league is unioned into
 * `leagues` so resolveLeague still accepts it even when the env allow-list
 * predates it.
 */
async function withResolvedDefault(game, config, trace) {
  if (!game.enabled) return { ...game, defaultLeagueSource: "fallback" };
  // No trace on a read path: the resolver's own default logger takes over, so a
  // degraded default league is never invisible outside the cron.
  const { league, source } = await resolveDefaultLeague(game.id, trace ? { config, trace } : { config });
  return {
    ...game,
    activeLeague: league,
    defaultLeagueSource: source,
    leagues: [...new Set([league, ...game.leagues])],
  };
}

/**
 * Every enabled game's resolved config. Only /api/config and the cron need all
 * of them; a single-game read route resolves just the game it was asked for
 * (resolveRequestedGame) rather than paying for both.
 */
export async function resolveGameConfigs(config, { trace = null } = {}) {
  return Promise.all(gameConfigs(config).map((game) => withResolvedDefault(game, config, trace)));
}

export function resolveGame(searchParams, config, definitions = gameConfigs(config)) {
  const requested = searchParams.get("game") ?? config.poeGame ?? "poe2";
  const game = definitions.find((entry) => entry.id === requested && entry.enabled);
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

/**
 * resolveGame for the single-game read routes: validate the requested game
 * first, then resolve the default league for THAT game only. The other game's
 * league metadata is irrelevant to this response and reading it would put a
 * second database round trip on the request path.
 */
export async function resolveRequestedGame(searchParams, config, { trace = null } = {}) {
  const selected = resolveGame(searchParams, config);
  if (selected.error) return selected;
  return { game: await withResolvedDefault(selected.game, config, trace) };
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

/**
 * Fold the `cx_identity` overrides on top of the process-cached identity maps.
 *
 * THE single bulk merge. `identityNames/Icons/Categories` in
 * src/domain/cx-identity.js deliberately know nothing about overrides — they
 * read the committed snapshot and only that — so there is exactly one place
 * where DB-over-JSON precedence is implemented for the radar, and one more
 * (`resolveCurrency(id, game, { overrides })`) for single-id lookups.
 *
 * The base maps hold thousands of entries and are built once per warm instance;
 * copying them per request to add a handful of overrides would be a real cost
 * for no reason. So the merged result is memoized against the overrides Map
 * ITSELF (a WeakMap): the loader hands out the same Map object for its whole
 * 10-minute TTL, so this spreads once per TTL, not once per request. A DB row
 * only ever ADDS or replaces a field it actually has — an override with a null
 * icon leaves the committed icon standing.
 */
const mergedIdentityCache = new WeakMap();
export function identityWithOverrides(identity, overrides) {
  if (!overrides || overrides.size === 0) return identity;
  const cached = mergedIdentityCache.get(overrides);
  if (cached?.base === identity) return cached.merged;
  const names = { ...identity.names };
  const icons = { ...identity.icons };
  const categories = { ...identity.categories };
  for (const [metadataId, row] of overrides) {
    // Key by the Metadata path and, when the DB knows one, by the trade short id
    // the ingest canonicalises to — the same two keys identityNames() writes.
    for (const key of row.shortId ? [metadataId, row.shortId] : [metadataId]) {
      if (row.name) names[key] = row.name;
      if (row.icon) icons[key] = row.icon;
      if (row.category) categories[key] = row.category;
    }
  }
  const merged = { names, icons, categories };
  mergedIdentityCache.set(overrides, { base: identity, merged });
  return merged;
}

function radarBuildInput(ctx, game, repo, now = Date.now(), anchors = game.anchors, overrides = null) {
  const isPoe2 = game.id === "poe2";
  const identity = identityWithOverrides(
    ctx.identityByGame[game.id] ?? { names: CORE_NAMES, icons: {}, categories: {} },
    overrides,
  );
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
  const selectedGame = await resolveRequestedGame(searchParams, config);
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
  //
  // A cache PEEK, never a load: whatever this instance already resolved within
  // the identity TTL, or an empty map. No database read, no await, on this path.
  //
  // This is the path a league launch lands on: a brand-new league has no stored
  // snapshot until the first hourly cron, so every cold request rebuilds, and it
  // does so on the day's heaviest traffic. Paying a bounded-but-cold 2s read to
  // decorate names here bought very little (the cron's own build loads identity,
  // so the snapshot it writes minutes later carries the overrides anyway) and
  // cost a great deal: the loader's onTimeout destroyed the max:1 client that
  // `repo` — captured above, before the loader ran — was about to query, which
  // surfaced as CONNECTION_DESTROYED and a 502.
  //
  // Peeking instead of skipping matters because the overrides carry `category`,
  // not just name and icon: without them an unmapped long-tail id renders "Needs
  // classification", and this payload is PERSISTED as a snapshot below, so that
  // degradation would outlive the cron run that should have fixed it. A warm
  // instance therefore rebuilds with exactly what the cron would have used, and
  // a cold one accepts the committed catalog for one snapshot rather than
  // putting a database read back on the slowest request path there is.
  const overrides = peekIdentityOverrides(game.id);
  const built = await withDbRetry(() => buildRadarPayloads(radarBuildInput(ctx, game, repo, Date.now(), requestedAnchors, overrides)));
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

// Latest point in the cron invocation at which a SECONDARY league build may
// START. `now` is the route's wall-clock start (route.js passes its startedAt),
// so gating against `now + SNAPSHOT_BUDGET_MS` reuses that clock instead of
// starting a second timer, and the live-ingest phase's own cxapiIngestBudgetMs
// spend is already counted in it.
//
// This is deliberately far below the 300s route ceiling because the gate CANNOT
// bound a build once it has begun: one league is 4 withDbRetry-wrapped reads
// plus a writeRadarSnapshots of up to 6 upserts inside a single withDbRetry, and
// with OP_TIMEOUT_MS at 18s and two attempts the pathological all-timeout case
// is ~320s on its own. Starting one of those late would blow both maxDuration
// and the pg_net statement timeout (migration 007), losing the cron response and
// its telemetry. Pass 1 has already durably written every active league by then,
// so an overrun costs observability, not data, and any league that does not fit
// simply keeps falling back to the on-demand rebuild in /api/radar as it does
// today.
const SNAPSHOT_BUDGET_MS = 120_000;
// Floor for the per-league reserve before a real build has been measured. Once
// the active league is built its observed elapsedMs takes over, with 1.5x
// headroom because a secondary league can be slower than the active one.
const SNAPSHOT_LEAGUE_RESERVE_MS = 60_000;
const snapshotLeagueReserve = (worstLeagueMs) =>
  Math.max(SNAPSHOT_LEAGUE_RESERVE_MS, Math.ceil(worstLeagueMs * 1.5));

/**
 * Rebuild the precomputed radar snapshots that /api/radar serves.
 *
 * Priority order is deliberate: every enabled game's ACTIVE league is rebuilt
 * first (unchanged behaviour), and only then do secondary leagues that have
 * recent priced candles get a turn. That way a league-launch day — several
 * public leagues live at once — can never starve the default landing scope.
 *
 * Secondary leagues are discovered with the same `listPricedLeagues()` probe
 * /api/config already uses (up to 64 rows per game), and each one is gated on
 * the shared wall-clock budget. The gate only decides whether to START a league;
 * it cannot interrupt one already running (see SNAPSHOT_BUDGET_MS).
 *
 * One extra league is NOT cheap. Per league, per game, every hour:
 *   - hasPricedCandles()      EXISTS probe over the 7-day window
 *   - readRadarSnapshot("auto")
 *   - listAnchorCandidates()  7-day group-by aggregate over the candle window
 *   - readCandleWindow()      the 7-day window itself, the dominant cost
 *   - writeRadarSnapshots()   up to 6 payload upserts (anchors + "auto")
 * Every one of those is withDbRetry-wrapped (two attempts) and capped at
 * OP_TIMEOUT_MS. Budget accordingly before widening the set further.
 *
 * A secondary league that fails is logged and recorded; it never fails the
 * active league or the cron response.
 */
export async function refreshRadarSnapshots(ctx, {
  now = Date.now(),
  trace = noop,
  clock = () => Date.now(),
  budgetMs = SNAPSHOT_BUDGET_MS,
  makeRepo = repository,
} = {}) {
  const deadlineAt = now + budgetMs;
  // Slowest league build observed in this invocation; the reserve is derived
  // from it so the guard calibrates on real cost once pass 1 has run.
  let worstLeagueMs = 0;
  const canStartAnotherLeague = () => clock() + snapshotLeagueReserve(worstLeagueMs) <= deadlineAt;

  const buildLeague = async (game, league) => {
    const startedAt = clock();
    trace("snapshot.scope.start", { game: game.id, league });
    try {
      const discoveryRepo = gameAwareRepository(
        makeRepo(scopeFor(ctx, game, league), { trace, anchors: game.anchors }),
        game.id,
      );
      if (!discoveryRepo || !(await withDbRetry(() => discoveryRepo.hasPricedCandles()))) {
        const skipped = { game: game.id, league, skipped: "no-data" };
        trace("snapshot.scope.end", skipped);
        return skipped;
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
        makeRepo(scopeFor(ctx, game, league), { trace, anchors: anchorPlan.anchors }),
        game.id,
      );
      // One read per game per invocation, not per league: the loader's cache is
      // keyed by game and outlives the whole cron run. Whatever the identity job
      // resolved overnight is baked into the snapshots here, so /api/radar's
      // fast path serves the better names without ever reading cx_identity.
      const overrides = await loadIdentityOverrides(game.id, { config: ctx.config, trace });
      const payloads = await withDbRetry(() =>
        buildRadarPayloads(radarBuildInput(ctx, game, repo, now, anchorPlan.anchors, overrides)),
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
        elapsedMs: clock() - startedAt,
      };
      trace("snapshot.scope.end", result);
      return result;
    } catch (error) {
      const result = {
        game: game.id,
        league,
        error: error?.message ?? String(error),
        elapsedMs: clock() - startedAt,
      };
      trace("snapshot.scope.error", result);
      return result;
    } finally {
      worstLeagueMs = Math.max(worstLeagueMs, clock() - startedAt);
    }
  };

  // The RESOLVED default league is pass 1's scope, not the env constant: the
  // league-meta step upstream may have just moved it, and the SEO surface and
  // the snapshot priority must agree on which league that is.
  const games = (await resolveGameConfigs(ctx.config, { trace })).filter((game) => game.enabled);
  const results = [];
  const built = new Map(games.map((game) => [game.id, new Set()]));

  // Pass 1 — the default landing scope of every enabled game, always, budget or
  // not. This is exactly what the cron did before secondary leagues existed.
  for (const game of games) {
    built.get(game.id).add(game.activeLeague);
    results.push(await buildLeague(game, game.activeLeague));
  }

  // Pass 2 — every other public league with recent priced candles. Discovery
  // failures degrade to "no secondary leagues this run", never to a failed cron.
  for (const game of games) {
    // Don't even pay for the discovery query once nothing else can start.
    if (!canStartAnotherLeague()) break;
    let discovered = [];
    try {
      const discoveryRepo = makeRepo(scopeFor(ctx, game, game.activeLeague), { trace, anchors: game.anchors });
      discovered = discoveryRepo?.listPricedLeagues
        ? await withDbRetry(() => discoveryRepo.listPricedLeagues())
        : [];
    } catch (error) {
      trace("snapshot.discovery.error", { game: game.id, error: error?.message ?? String(error) });
      discovered = [];
    }
    for (const row of discovered) {
      const league = row?.league;
      if (typeof league !== "string" || !league) continue;
      if (built.get(game.id).has(league)) continue;
      // Defence in depth: normalizeCxDigest already drops private (PLnnnnn)
      // leagues at ingest. getConfig's leagueAvailability deliberately does NOT
      // re-filter — it only reports what exists — whereas spending cron budget
      // on a private scope would be a real cost, so this consumer does.
      if (!isPublicLeague(league)) continue;
      built.get(game.id).add(league);
      if (!canStartAnotherLeague()) {
        const skipped = { game: game.id, league, skipped: "budget" };
        results.push(skipped);
        // Paired start/end so every league in the run reads the same way in the
        // trace, exactly like the "no-data" skip inside buildLeague.
        trace("snapshot.scope.start", { game: game.id, league });
        trace("snapshot.scope.end", skipped);
        continue;
      }
      results.push(await buildLeague(game, league));
    }
  }
  return results;
}

/**
 * Hourly league-metadata refresh + default-league decision.
 *
 * Runs after ingest and BEFORE snapshots, because the snapshot pass builds the
 * default league first and must build the league this step just chose. Per
 * enabled game: one bounded aggregate over the candle window, then the pure
 * chooseDefaultLeague rule, then a persist only when the answer actually moved.
 *
 * Everything here is best-effort. A missing table (code deployed ahead of
 * migration 009), a timeout, a transient connection error — all are traced and
 * returned as a per-game result, and none of them fails the cron. The resolver's
 * cache is invalidated afterwards so the snapshot pass in the SAME invocation
 * sees a default this run just wrote.
 */
export async function refreshLeagueDefaults(ctx, {
  now = Date.now(),
  trace = noop,
  makeRepo = repository,
} = {}) {
  const results = [];
  // Start from the database, not from whatever this warm instance cached before
  // the ingest wrote new candles.
  resetLeagueMetaCache();
  for (const game of gameConfigs(ctx.config).filter((entry) => entry.enabled)) {
    trace("league-meta.scope.start", { game: game.id });
    try {
      // The aggregate is league-independent; the scope league only completes the
      // repository's key. Provider is the READ provider, matching the snapshots
      // and the resolver, so the rows land where the readers look for them.
      const repo = makeRepo(scopeFor(ctx, game, game.activeLeague), { trace, anchors: game.anchors });
      if (!repo?.refreshLeagueMeta) {
        const skipped = { game: game.id, skipped: "no-database" };
        trace("league-meta.scope.end", skipped);
        results.push(skipped);
        continue;
      }
      const rows = await withDbRetry(() => repo.refreshLeagueMeta({ now }));
      const storedDefault = rows.find((row) => row.isDefault)?.league ?? null;
      // Without a stored decision the rule starts from what the readers use
      // today, so its forward-only guard is anchored on the live default rather
      // than on nothing.
      const currentDefault = storedDefault ?? (await resolveDefaultLeague(game.id, { config: ctx.config, trace })).league;
      const chosen = chooseDefaultLeague(rows, { game: game.id, currentDefault, now });
      const changed = Boolean(chosen) && chosen !== storedDefault;
      if (changed) await withDbRetry(() => repo.setDefaultLeague(chosen));
      const result = {
        game: game.id,
        leagues: rows.length,
        previousDefault: storedDefault,
        defaultLeague: chosen ?? currentDefault,
        changed,
      };
      trace("league-meta.scope.end", result);
      results.push(result);
    } catch (error) {
      const result = { game: game.id, error: error?.message ?? String(error), errorCode: error?.code ?? null };
      trace("league-meta.scope.error", result);
      results.push(result);
    }
  }
  // Whatever happened above, the next resolve must not serve a pre-cron answer.
  resetLeagueMetaCache();
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
  const selectedGame = await resolveRequestedGame(searchParams, config);
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
  const selectedGame = await resolveRequestedGame(searchParams, config);
  if (selectedGame.error) return selectedGame.error;
  const { game } = selectedGame;
  const selected = await resolveLeagueAccess(searchParams, game, async (requestedLeague) => {
    const candidate = repository(scopeFor(ctx, game, requestedLeague), { anchors: game.anchors });
    return candidate ? withDbRetry(() => candidate.hasPricedCandles()) : false;
  });
  if (selected.error) return selected.error;
  const repo = gameAwareRepository(await resolveRepo(ctx, scopeFor(ctx, game, selected.league)), game.id);
  if (!repo) return NO_DB;
  // Unlike /api/radar there is no precomputed-snapshot short circuit to sit
  // below: the hotlist is ALWAYS built from candles here, and the build needs
  // the names map. So this load is on the only path there is. It is the same
  // bounded 2s/one-attempt read, and it is a cache hit for the next ten minutes.
  const overrides = await loadIdentityOverrides(game.id, { config });
  const names = identityWithOverrides(
    identityByGame[game.id] ?? { names: CORE_NAMES, icons: {}, categories: {} },
    overrides,
  ).names;
  const body = await withDbRetry(() =>
    buildHotlistPayload({
      repo,
      anchors: game.anchors,
      shortlist: config.shortlist,
      names,
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
  const definitions = await resolveGameConfigs(config);
  const leagueState = await leagueAvailability(ctx, definitions);
  // Observed depth per league, from league_meta. Additive and best-effort: with
  // no table and no database every field below is simply null/0.
  const metaByGame = new Map(
    await Promise.all(
      definitions.map(async (game) => [game.id, (await readLeagueMetaCached(game.id, { config })).byLeague]),
    ),
  );
  const games = definitions.map((game) => {
    const meta = metaByGame.get(game.id) ?? new Map();
    const allLeagues = [...new Set([
      ...game.leagues,
      ...(leagueState?.discovered.get(game.id) ?? []),
    ])];
    const leagues = allLeagues.map((league) => {
      const row = meta.get(league) ?? null;
      return {
        id: league,
        label: league,
        enabled: leagueState?.available.get(`${game.id}|${league}`) !== false,
        // "first seen on the exchange" — our own first priced hour, not a GGG
        // start date. Null until the cron has aggregated this league once.
        firstSeenAt: row?.firstSeenAt ? new Date(row.firstSeenAt).toISOString() : null,
        lastSeenAt: row?.lastSeenAt ? new Date(row.lastSeenAt).toISOString() : null,
        pairCount: row?.pairCount ?? 0,
        completedHours: row?.completedHours ?? 0,
      };
    });
    const enabledLeagueIds = leagues.filter((entry) => entry.enabled).map((entry) => entry.id);
    return {
      ...game,
      // Belt and braces, no longer a second opinion: resolveDefaultLeague now
      // applies the same "no priced candles -> best league that has them" rule
      // using league_meta depth, so the read routes and this response agree.
      // This keeps the live EXISTS probe as the last word for the narrow window
      // where hourly league_meta and the candle table disagree (a league pruned
      // since the last cron run).
      activeLeague: enabledLeagueIds.includes(game.activeLeague)
        ? game.activeLeague
        : enabledLeagueIds[0] ?? game.activeLeague,
      reason: game.enabled ? null : "Market stream is not configured",
      leagues,
    };
  });
  const primary = games.find((game) => game.id === config.poeGame) ?? games[0];
  return {
    status: 200,
    body: {
      league: primary?.activeLeague ?? config.league,
      // Where that default came from: an env pin, the league_meta row the cron
      // maintains, or the code constant.
      defaultLeagueSource: primary?.defaultLeagueSource ?? "fallback",
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
    // Leagues become data here: aggregate what the candles now say, decide the
    // default, persist it — then let the snapshot pass build that league first.
    const leagueMeta = await refreshLeagueDefaults(await context(), { now, trace });
    const snapshots = await refreshRadarSnapshots(await context(), { now, trace });
    return { status: 200, body: { mode: "live", streams, leagueMeta, snapshots } };
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
  const leagueMeta = await refreshLeagueDefaults(await context(), { now, trace });
  const snapshots = await refreshRadarSnapshots(await context(), { now, trace });
  return { status: 200, body: { ...summary, leagueMeta, snapshots } };
}

export async function getStatus() {
  const ctx = await context();
  const { config } = ctx;
  // /api/status reports the scope the SEO surface actually renders, so it must
  // read the same resolved default as everything else — not the env constant.
  const { league, source } = await resolveDefaultLeague(config.poeGame, { config });
  const repo = await resolveRepo(ctx, { ...ctx.scope, league });
  // How much of the currency identity is coming from the database rather than
  // the committed snapshot, and how much of it is still only half-resolved. Both
  // numbers fall out of the SAME cached read the radar already does — no extra
  // query, and no `cx_identity_runs` table to keep in sync. `iconlessRows` is
  // named for exactly what it counts: stored rows with no icon, which is the set
  // the job's retry window will pick up again.
  const identityState = await readIdentityOverridesCached(config.poeGame, { config });
  const base = {
    providerMode: config.providerMode,
    ingestProviderMode: config.ingestProviderMode,
    league,
    defaultLeagueSource: source,
    sourceMode: sourceMode(config),
    identity: {
      overrides: identityState.overrides.size,
      iconlessRows: identityState.iconless,
    },
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
