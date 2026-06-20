/**
 * Environment-driven configuration. No seasonal league is hardcoded as the only
 * option; everything below can be overridden via env (see .env.example).
 *
 * @typedef {Object} AppConfig
 * @property {number} port
 * @property {"fixture"|"live"} providerMode
 * @property {string} poeGame
 * @property {string} poeRealm
 * @property {string} league
 * @property {string} anchorCurrency
 * @property {string[]} shortlist
 * @property {number} pollIntervalMs
 * @property {number} maxListingAgeMs
 * @property {number} batchSize
 * @property {string} userAgent
 * @property {string|null} contactEmail
 * @property {string|null} poesessid
 */

/** @returns {AppConfig} */
export function loadConfig(env = process.env) {
  const providerMode = (env.PROVIDER_MODE ?? "fixture").toLowerCase() === "live" ? "live" : "fixture";
  // Configured PoE2 leagues. The active LEAGUE is always included and is the
  // only one currently polled; others are advertised but not yet pollable.
  const league = env.LEAGUE ?? "Runes of Aldur";
  const leagues = list(env.LEAGUES, [league]);
  if (!leagues.includes(league)) leagues.unshift(league);

  // Active anchor + the set of anchors the scheduler maintains books for. The
  // active anchor is always included. Each anchor needs a gold cost (exit gold).
  const anchorCurrency = (env.ANCHOR_CURRENCY ?? "exalted").trim() || "exalted";
  const anchors = [...new Set(list(env.ANCHORS, [anchorCurrency, "divine"]))];
  if (!anchors.includes(anchorCurrency)) anchors.unshift(anchorCurrency);

  return {
    port: int(env.PORT, 8080),
    providerMode,
    poeGame: env.POE_GAME ?? "poe2",
    poeRealm: env.POE_REALM ?? "poe2",
    league,
    leagues,
    anchors,
    anchorCurrency,
    shortlist: list(env.SHORTLIST, ["divine", "chaos", "vaal"]),
    pollIntervalMs: int(env.POLL_INTERVAL_MS, 5 * 60 * 1000),
    maxListingAgeMs: int(env.MAX_LISTING_AGE_MS, 15 * 60 * 1000),
    batchSize: int(env.BATCH_SIZE, 4),
    userAgent:
      env.USER_AGENT ??
      "poe2-currency-flip-tracker/0.1 (experimental; non-commercial; contact via config)",
    contactEmail: env.CONTACT_EMAIL ?? null,
    poesessid: env.POESESSID ?? null,

    // --- Phase B: storage ---
    // "local" (default, zero-dep JSONL) or "supabase" (durable Postgres). Supabase
    // additionally requires DATABASE_URL and `npm install postgres`; without the
    // URL it transparently falls back to local.
    storageMode: (env.STORAGE ?? "local").toLowerCase() === "supabase" ? "supabase" : "local",
    databaseUrl: env.DATABASE_URL ?? null, // server-side only; never exposed to the browser

    // --- A3: backend-controlled polling / API protection ---
    // Token for the protected admin force-refresh endpoint. When null the
    // endpoint is disabled entirely (users can never force a provider fetch).
    adminToken: env.ADMIN_TOKEN ?? null,
    // Only trust X-Forwarded-For when explicitly behind a known proxy.
    trustProxy: (env.TRUST_PROXY ?? "false").toLowerCase() === "true",
    // Per-IP sliding-window rate limit for the frontend API. Range-validated so
    // a zero/negative value can't silently disable protection (or block all).
    apiRateLimitPerMin: posInt(env.API_RATE_LIMIT_PER_MIN, 120, 1),
    apiRateWindowMs: posInt(env.API_RATE_WINDOW_MS, 60_000, 1000),
    // Circuit breaker around the provider: after N consecutive failures, stop
    // hitting it and back off exponentially (capped). max is forced >= base.
    circuitFailureThreshold: posInt(env.CIRCUIT_FAILURE_THRESHOLD, 3, 1),
    circuitCooldownBaseMs: posInt(env.CIRCUIT_COOLDOWN_BASE_MS, 30_000, 1000),
    circuitCooldownMaxMs: Math.max(
      posInt(env.CIRCUIT_COOLDOWN_BASE_MS, 30_000, 1000),
      posInt(env.CIRCUIT_COOLDOWN_MAX_MS, 300_000, 1000),
    ),
    maxQueryLength: posInt(env.MAX_QUERY_LENGTH, 2048, 16),

    // --- C2: bounded tiered polling (live mode) ---
    schedulerEnabled: (env.TIERED_SCHEDULER ?? "true").toLowerCase() !== "false",
    marketCategories: list(env.MARKET_CATEGORIES, ["Currency", "Fragments", "Essences"]),
    warmBatchSize: posInt(env.WARM_BATCH_SIZE, 4, 1),
    coldBatchSize: posInt(env.COLD_BATCH_SIZE, 4, 1),
    warmIntervalMs: posInt(env.WARM_INTERVAL_MS, 15 * 60 * 1000, 60_000),
    coldIntervalMs: posInt(env.COLD_INTERVAL_MS, 60 * 60 * 1000, 60_000),
    maxTrackedTargets: posInt(env.MAX_TRACKED_TARGETS, 250, 10),
  };
}

function int(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Positive integer with a hard minimum; invalid/below-min falls back. */
function posInt(value, fallback, min) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < min) return fallback < min ? min : fallback;
  return n;
}

function list(value, fallback) {
  if (!value) return fallback;
  const parts = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : fallback;
}
