/**
 * HTTP app: routes, in-memory snapshot store, and static frontend serving.
 *
 * Backend-controlled polling (A3):
 *   - User requests NEVER hit the provider. Only the scheduler (or a protected
 *     admin endpoint) calls `refresh()`.
 *   - Reads are served from the cached snapshot (stale-while-revalidate): a
 *     stale snapshot is still served, clearly marked `fresh:false`.
 *   - A circuit breaker stops hammering a failing provider and backs off
 *     exponentially; the last good snapshot keeps being served as `degraded`.
 *   - Per-IP rate limiting protects the API.
 *
 * Honesty rules: a data failure surfaces as a failure; fabricated/sample
 * opportunities are NEVER served.
 */

import { readFile } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { timingSafeEqual } from "node:crypto";

import { randomUUID } from "node:crypto";

import { fetchBooks, computeOpportunities, RANKING_MODES, catalogTargets, mergeBooks, pruneBooks } from "./snapshot.js";
import { buildBook, bookDepth } from "../domain/order-book.js";
import { pointFromBooks } from "./history-store.js";
import { normalizeConstraints, GOLD_MODES, GOLD_MODE_DEFAULT } from "./constraints.js";
import { validateShortlistCoverage } from "../domain/gold-costs.js";
import { buildManifest, nameMapFromCatalog } from "../domain/catalog.js";

const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

/**
 * @param {import("./config.js").AppConfig} config
 * @param {{ provider: any, goldRegistry: any, historyStore?: any }} deps
 */
export function createApp(config, { provider, goldRegistry, storage = null, logger = () => {}, catalog = null, scheduler = null }) {
  const store = {
    booksByAnchor: {}, // anchor -> { fetchedAt, anchorId, byTarget }
    fetchedAt: 0,
    lastError: null,
    refreshing: null,
    // circuit breaker + observability
    consecutiveFailures: 0,
    circuitOpenUntil: 0,
    lastRefreshAt: 0,
    lastRefreshDurationMs: null,
    lastSuccessAt: 0,
    refreshCount: 0,
    failureCount: 0,
    lastPrune: 0,
    lastPlan: null,
  };

  const MAX_TRACKED_IPS = 50_000; // hard bound on limiter memory under churn/spoofing
  // Names cover every target across all anchors (shortlist ∪ anchors); the
  // catalog's real display names win over the gold table's.
  const unionIds = [...new Set([...config.shortlist, ...config.anchors])];
  const names = nameMap(unionIds, goldRegistry);
  if (catalog) {
    const catNames = nameMapFromCatalog(catalog);
    Object.assign(names, catNames);
  }
  const catalogManifest = catalog ? buildManifest(catalog, goldRegistry) : [];
  const coverage = validateShortlistCoverage(goldRegistry, {
    anchorCurrency: config.anchorCurrency,
    shortlist: config.shortlist,
  });

  const apiHits = new Map(); // ip -> timestamps[] (sliding window)

  /**
   * Refresh the snapshot from the provider. Single-flight + circuit breaker.
   * Returns the in-flight promise (or undefined when the circuit is open).
   * ONLY the scheduler / admin endpoint should call this.
   */
  function refresh({ force = false } = {}) {
    if (store.refreshing) return store.refreshing;
    const now = Date.now();
    if (!force && store.circuitOpenUntil && now < store.circuitOpenUntil) {
      return undefined; // breaker open — do not hit the provider
    }
    store.refreshing = (async () => {
      const startedAt = Date.now();
      const cycleId = randomUUID(); // links all anchors of this atomic refresh
      try {
        const plan = scheduler?.next({ force, at: startedAt }) ?? {
          targets: config.shortlist,
          tiers: ["manual"],
          plannedAt: startedAt,
        };
        store.lastPlan = plan;
        // Star-shaped: one cached book set per anchor (Exalted, Divine, ...).
        // Stage the whole cycle and commit atomically — a mid-cycle failure must
        // not leave anchors from different polling generations, and must keep the
        // last fully-good snapshot intact (stale-while-revalidate).
        const next = {};
        for (const anchor of config.anchors) {
          const incremental = await fetchBooks(provider, {
            anchorId: anchor,
            shortlist: catalogTargets(anchor, plan.targets, config.anchors),
            batchSize: config.batchSize,
          });
          next[anchor] = pruneBooks(mergeBooks(store.booksByAnchor[anchor], incremental), {
            maxTargets: config.maxTrackedTargets,
            preserve: catalogTargets(anchor, config.shortlist, config.anchors),
          });
        }
        store.booksByAnchor = next;
        store.fetchedAt = Date.now();
        store.lastError = null;
        store.consecutiveFailures = 0;
        store.circuitOpenUntil = 0;
        store.lastSuccessAt = Date.now();
        scheduler?.commit?.(plan);

        // Durably record the cycle. Best-effort AND fully isolated: a storage
        // error/stall must never turn a successful fetch into a "failed" refresh
        // (which would wrongly open the circuit). The snapshot is already live.
        if (storage) {
          try {
            await storage.recordSuccessfulCycle({
              cycleId,
              startedAt,
              durationMs: Date.now() - startedAt,
              anchors: config.anchors.map((anchor) => ({
                anchor,
                fetchedAt: next[anchor].fetchedAt,
                marketPoints: marketPointsFor(next[anchor], new Set(catalogTargets(anchor, plan.targets, config.anchors))),
              })),
            });
          } catch (err) {
            process.stderr.write(`[poe2-flip] storage write error: ${err.message}\n`);
          }
        }
        logger({
          event: "refresh",
          ok: true,
          mode: provider.mode,
          anchors: config.anchors.length,
          tiers: plan.tiers,
          targets: plan.targets.length,
          durationMs: Date.now() - startedAt,
        });
      } catch (err) {
        // Keep previously good books; surface the failure, never fabricate.
        store.consecutiveFailures += 1;
        store.failureCount += 1;
        // Log full detail server-side; expose only a safe, generic message so
        // upstream URLs / filesystem paths never reach a client.
        process.stderr.write(`[poe2-flip] refresh failed: ${err.stack ?? err}\n`);
        store.lastError = { code: err.code ?? "fetch-failed", message: "upstream data source unavailable" };
        if (store.consecutiveFailures >= config.circuitFailureThreshold) {
          const over = store.consecutiveFailures - config.circuitFailureThreshold;
          const cooldown = Math.min(config.circuitCooldownMaxMs, config.circuitCooldownBaseMs * 2 ** over);
          store.circuitOpenUntil = Date.now() + cooldown;
        }
        if (storage) {
          await storage
            .recordFailedCycle({
              cycleId,
              startedAt,
              durationMs: Date.now() - startedAt,
              anchors: config.anchors,
              error: store.lastError,
            })
            .catch(() => {});
        }
        logger({
          event: "refresh",
          ok: false,
          mode: provider.mode,
          code: store.lastError.code,
          consecutiveFailures: store.consecutiveFailures,
          circuitOpen: store.circuitOpenUntil > Date.now(),
        });
      } finally {
        store.refreshCount += 1;
        store.lastRefreshAt = Date.now();
        store.lastRefreshDurationMs = Date.now() - startedAt;
        store.refreshing = null;
      }
    })();
    return store.refreshing;
  }

  /** Market-only history points for one anchor's books. */
  function marketPointsFor(books, updatedTargets = null) {
    return Object.entries(books.byTarget)
      .filter(([target]) => !updatedTargets || updatedTargets.has(target))
      .filter(([, legs]) => legs.entryLevels.length > 0 || legs.exitLevels.length > 0)
      .map(([target, legs]) =>
        pointFromBooks({
          target,
          t: legs.fetchedAt ?? books.fetchedAt,
          entryBook: buildBook(legs.entryLevels),
          exitBook: buildBook(legs.exitLevels),
          bookDepth,
        }),
      );
  }

  function statusSummary() {
    const now = Date.now();
    return {
      providerMode: provider.mode,
      league: config.league,
      anchors: config.anchors,
      activeAnchors: Object.keys(store.booksByAnchor),
      hasSnapshot: Object.keys(store.booksByAnchor).length > 0,
      snapshotAt: store.fetchedAt ? new Date(store.fetchedAt).toISOString() : null,
      cacheAgeMs: store.fetchedAt ? now - store.fetchedAt : null,
      fresh:
        store.fetchedAt > 0 &&
        !store.lastError &&
        Object.values(store.booksByAnchor).every((books) =>
          Object.entries(books.byTarget).every(([id, legs]) => !marketFreshnessFor(id, legs, now).stale),
        ),
      degraded: Boolean(store.lastError) && Object.keys(store.booksByAnchor).length > 0,
      lastError: store.lastError,
      lastSuccessAt: store.lastSuccessAt ? new Date(store.lastSuccessAt).toISOString() : null,
      lastRefreshAt: store.lastRefreshAt ? new Date(store.lastRefreshAt).toISOString() : null,
      lastRefreshDurationMs: store.lastRefreshDurationMs,
      refreshCount: store.refreshCount,
      failureCount: store.failureCount,
      consecutiveFailures: store.consecutiveFailures,
      circuitOpen: store.circuitOpenUntil > now,
      circuitOpenForMs: store.circuitOpenUntil > now ? store.circuitOpenUntil - now : 0,
      pollIntervalMs: config.pollIntervalMs,
      scheduler: scheduler?.status() ?? { enabled: false },
      lastPlan: store.lastPlan,
      trackedByAnchor: Object.fromEntries(
        Object.entries(store.booksByAnchor).map(([anchor, books]) => [anchor, Object.keys(books.byTarget).length]),
      ),
    };
  }

  async function handler(req, res) {
    const url = new URL(req.url, "http://localhost");
    try {
      // Reject oversized query strings outright.
      if (url.search.length > config.maxQueryLength) {
        return json(res, 414, { error: { code: "query-too-long", message: "query string too long" } });
      }

      const isApi = url.pathname.startsWith("/api/") || url.pathname.startsWith("/admin/");
      if (isApi && rateLimited(clientIp(req))) {
        return json(
          res,
          429,
          { error: { code: "rate-limited", message: "too many requests" } },
          { "Retry-After": Math.ceil(config.apiRateWindowMs / 1000) },
        );
      }

      if (req.method === "GET" && url.pathname === "/health") {
        return json(res, 200, { status: "ok", providerMode: provider.mode, league: config.league });
      }

      if (req.method === "GET" && url.pathname === "/api/status") {
        return json(res, 200, statusSummary());
      }

      if (req.method === "GET" && url.pathname === "/api/config") {
        return json(res, 200, {
          league: config.league,
          game: config.poeGame,
          realm: config.poeRealm,
          games: buildGames(config),
          anchorCurrency: config.anchorCurrency,
          anchors: config.anchors,
          shortlist: config.shortlist,
          providerMode: provider.mode,
          providerLabel: provider.label,
          pollIntervalMs: config.pollIntervalMs,
          maxListingAgeMs: config.maxListingAgeMs,
          goldGame: goldRegistry.game,
          goldModes: GOLD_MODES,
          goldModeDefault: GOLD_MODE_DEFAULT,
          rankingModes: RANKING_MODES,
          shortlistCoverage: coverage,
          scheduler: scheduler?.status() ?? { enabled: false },
        });
      }

      if (req.method === "GET" && url.pathname === "/api/opportunities") {
        return handleOpportunities(url, res);
      }

      if (req.method === "GET" && url.pathname === "/api/catalog") {
        return json(res, 200, {
          game: catalog?.game ?? config.poeGame,
          source: catalog?.source ?? null,
          count: catalogManifest.length,
          items: catalogManifest,
        });
      }

      if (req.method === "GET" && url.pathname === "/api/history") {
        const anchor = config.anchors.includes(url.searchParams.get("anchor"))
          ? url.searchParams.get("anchor")
          : config.anchorCurrency;
        const buf = storage ? storage.series(anchor) : null;
        const target = url.searchParams.get("target");
        const series = buf ? (target ? { [target]: buf.get(target) } : buf.all()) : {};
        return json(res, 200, { anchor, generatedAt: new Date().toISOString(), series });
      }

      // Protected admin force-refresh — the ONLY user-reachable way to trigger a
      // provider fetch, and only with the configured token.
      if (req.method === "POST" && url.pathname === "/admin/refresh") {
        return await handleAdminRefresh(req, res);
      }

      if (req.method === "GET") {
        return await serveStatic(url.pathname, res);
      }

      return json(res, 405, { error: { code: "method-not-allowed", message: req.method } });
    } catch (err) {
      process.stderr.write(`[poe2-flip] request error: ${err.stack ?? err}\n`);
      return json(res, 500, { error: { code: "internal", message: "internal error" } });
    }
  }

  /** Reads serve the cached snapshot only (stale-while-revalidate). No provider call. */
  function handleOpportunities(url, res) {
    const anchor = config.anchors.includes(url.searchParams.get("anchor"))
      ? url.searchParams.get("anchor")
      : config.anchorCurrency;
    const books = store.booksByAnchor[anchor];
    if (!books) {
      // No usable snapshot yet. Distinguish "still warming up" from "the provider
      // failed" — but never fabricate rows. Both are retryable (503).
      const warming = !store.lastError;
      return json(
        res,
        503,
        {
          state: warming ? "warming" : "error",
          error: store.lastError ?? { code: "no-data", message: "Snapshot not ready yet." },
          providerMode: provider.mode,
          league: config.league,
        },
        { "Retry-After": Math.ceil(config.pollIntervalMs / 1000) },
      );
    }

    const { constraints, adjustments } = normalizeConstraints(parseRawConstraints(url.searchParams));
    const rankingMode = RANKING_MODES.includes(url.searchParams.get("rank"))
      ? url.searchParams.get("rank")
      : "default";
    const opportunities = computeOpportunities({
      books,
      goldRegistry,
      constraints,
      names,
      history: storage ? storage.series(anchor).all() : {},
      rankingMode,
      now: Date.now(),
      maxListingAgeMs: config.maxListingAgeMs,
    }).map((opportunity) => {
      const target = books.byTarget[opportunity.targetCurrency];
      return {
        ...opportunity,
        marketFreshness: marketFreshnessFor(opportunity.targetCurrency, target, Date.now()),
      };
    });

    const ageMs = Date.now() - store.fetchedAt;
    const fresh = opportunities.every((opportunity) => !opportunity.marketFreshness.stale) && !store.lastError;
    return json(res, 200, {
      state: provider.mode, // "fixture" | "live"
      degraded: Boolean(store.lastError),
      lastError: store.lastError,
      league: config.league,
      anchorCurrency: anchor,
      providerLabel: provider.label,
      snapshotAt: new Date(store.fetchedAt).toISOString(),
      ageMs,
      fresh,
      maxListingAgeMs: config.maxListingAgeMs,
      pollIntervalMs: config.pollIntervalMs,
      shortlistCoverage: coverage,
      goldMode: constraints.goldMode,
      rankingMode,
      constraints,
      constraintAdjustments: adjustments,
      opportunities,
    });
  }

  function marketFreshnessFor(targetId, legs, now) {
    const fetchedAt = legs?.fetchedAt ?? null;
    const ageMs = fetchedAt == null ? null : now - fetchedAt;
    const tier = scheduler?.tierOf(targetId) ?? "manual";
    const expectedIntervalMs =
      tier === "warm" ? config.warmIntervalMs : tier === "cold" ? config.coldIntervalMs : config.pollIntervalMs;
    return {
      tier,
      fetchedAt: fetchedAt ? new Date(fetchedAt).toISOString() : null,
      ageMs,
      expectedIntervalMs,
      stale: ageMs == null || ageMs > expectedIntervalMs * 1.5,
    };
  }

  async function handleAdminRefresh(req, res) {
    if (!config.adminToken) {
      // Disabled — don't reveal the endpoint exists.
      return json(res, 404, { error: { code: "not-found", message: "/admin/refresh" } });
    }
    const token = headerValue(req, "x-admin-token");
    if (!safeEqual(token, config.adminToken)) {
      return json(res, 403, { error: { code: "forbidden", message: "invalid admin token" } });
    }
    await refresh({ force: true });
    // Report the real outcome: a failed provider fetch must not look successful.
    const ok = !store.lastError;
    return json(res, ok ? 200 : 502, {
      refreshed: ok,
      error: ok ? undefined : store.lastError,
      status: statusSummary(),
    });
  }

  async function serveStatic(pathname, res) {
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return json(res, 400, { error: { code: "bad-path", message: "malformed URL path" } });
    }
    const rel = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
    const safe = normalize(rel).replace(/^(\.\.[/\\])+/, "");
    const filePath = join(PUBLIC_DIR, safe);
    if (!filePath.startsWith(PUBLIC_DIR)) {
      return json(res, 403, { error: { code: "forbidden", message: "path traversal" } });
    }
    try {
      const body = await readFile(filePath);
      res.writeHead(200, { "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      return json(res, 404, { error: { code: "not-found", message: pathname } });
    }
  }

  function clientIp(req) {
    // X-Forwarded-For is client-controlled and spoofable; only honour it when
    // explicitly behind a proxy that OVERWRITES the header (TRUST_PROXY=true).
    if (config.trustProxy) {
      const xff = headerValue(req, "x-forwarded-for");
      if (xff) return String(xff).split(",")[0].trim();
    }
    return req.socket?.remoteAddress ?? "unknown";
  }

  function pruneHits(now) {
    const cutoff = now - config.apiRateWindowMs;
    for (const [ip, arr] of apiHits) {
      const recent = arr.filter((t) => t > cutoff);
      if (recent.length === 0) apiHits.delete(ip);
      else apiHits.set(ip, recent);
    }
  }

  /** Sliding-window per-IP limiter. Returns true when the request is over budget. */
  function rateLimited(ip) {
    const now = Date.now();
    // Sweep stale buckets at most once per window so idle/churned IPs (incl. IPv6
    // address rotation) can't grow `apiHits` without bound.
    if (now - store.lastPrune > config.apiRateWindowMs) {
      store.lastPrune = now;
      pruneHits(now);
    }
    const cutoff = now - config.apiRateWindowMs;
    const recent = (apiHits.get(ip) ?? []).filter((t) => t > cutoff);
    if (recent.length >= config.apiRateLimitPerMin) {
      apiHits.set(ip, recent);
      return true;
    }
    recent.push(now);
    apiHits.set(ip, recent);
    if (apiHits.size > MAX_TRACKED_IPS) pruneHits(now); // hard memory bound under attack
    return false;
  }

  return { handler, refresh, status: statusSummary, store };
}

/** Raw (un-clamped) constraints from the query; normalizeConstraints validates. */
function parseRawConstraints(params) {
  return {
    currencyCapital: numParam(params, "capital", 1000),
    goldAvailable: numParam(params, "gold", 200000),
    goldReserve: numParam(params, "reserve", 0),
    goldIncomePerHour: params.has("income") ? numParam(params, "income", 0) : null,
    horizonHours: numParam(params, "horizon", 3),
    maxPositionTarget: params.has("maxPosition") ? numParam(params, "maxPosition", 0) : null,
    goldMode: params.get("goldMode") ?? undefined,
  };
}

function numParam(params, key, fallback) {
  if (!params.has(key)) return fallback;
  const n = Number(params.get(key));
  return Number.isFinite(n) ? n : fallback;
}

function headerValue(req, name) {
  const h = req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
  return Array.isArray(h) ? h[0] : h ?? null;
}

/** Constant-time string compare (length-safe) for secret tokens. */
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Game/league catalog for the frontend selectors. PoE2 is active; PoE1 is
 * advertised but disabled ("Coming later") and never shares data with PoE2.
 * Only the active league is currently pollable.
 */
function buildGames(config) {
  return [
    {
      id: "poe2",
      label: "Path of Exile 2",
      realm: config.poeRealm,
      enabled: true,
      activeLeague: config.league,
      leagues: config.leagues.map((l) => ({ id: l, label: l, enabled: l === config.league })),
    },
    { id: "poe1", label: "Path of Exile", enabled: false, reason: "Coming later", leagues: [] },
  ];
}

function nameMap(shortlist, goldRegistry) {
  const names = {};
  for (const id of shortlist) names[id] = goldRegistry.record?.(id)?.displayName ?? id;
  return names;
}

function json(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  res.end(payload);
}
