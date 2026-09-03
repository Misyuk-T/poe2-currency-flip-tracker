import postgres from "postgres";

/**
 * Lazily-created, module-cached Postgres clients for serverless route handlers.
 * A warm lambda reuses them across invocations. Tuned for Supabase's Supavisor
 * transaction pooler (port 6543): prepared statements OFF, a small pool per
 * instance, and a server-side statement timeout.
 *
 * getSql() returns null when DATABASE_URL is absent so routes can degrade to a
 * clean 503 instead of throwing at import time (e.g. local dev without a DB).
 *
 * THERE ARE TWO CLIENTS, and the split is load-bearing:
 *
 *   "request" (getSql / resetSql)
 *       Everything that does the actual work: route handlers, the radar
 *       rebuild, the hourly snapshot cron, ingest transactions.
 *
 *   "loader"  (getLoaderSql / resetLoaderSql)
 *       ONLY the two bounded, never-load-bearing resolvers on the request path
 *       — apps/web/lib/identity-overrides.js and apps/web/lib/default-league.js.
 *       They run at `opTimeoutMs: 2_000, attempts: 1` and destroy their client
 *       when that budget is blown, because postgres.js would otherwise keep the
 *       abandoned query holding the connection.
 *
 * Before the split those loaders destroyed the SHARED client. The stable handle
 * below fixes holders that merely captured a reference, but it cannot relocate
 * work that is already in flight: a postgres.js Query is bound to the client
 * that created it, and the `tx` inside sql.begin() must stay on one connection
 * by definition. So a 2s loader timeout could still abort a concurrent read or,
 * worse, an ingest transaction running in the same invocation — the cron does
 * loader work alongside repository work. Giving the loaders their own max:1
 * client makes that impossible: their timeout can only ever destroy a
 * connection nothing else is using.
 *
 * Cost: up to two pooled connections per warm instance instead of one. The
 * loader connection is idle almost all the time (one bounded read per 60s /
 * 10-minute TTL) and `idle_timeout: 20` reclaims it, which is exactly the kind
 * of churn the pooler exists to absorb.
 */
const CLIENT_OPTIONS = {
  prepare: false, // required for Supavisor transaction pooling
  ssl: "require",
  max: 1, // one connection per warm instance; the pooler fans out concurrency
  idle_timeout: 20,
  connect_timeout: 10,
  // Headroom for the cold path: a request landing on a cold instance pays
  // lambda start and a fresh pooled connection before the query runs, and
  // Postgres plans it against a cold cache. 8s left no room for that and
  // surfaced as a 502 on the first visit after an idle stretch. Warm reads
  // finish far inside this; a query that genuinely needs longer is a
  // missing index, not a budget to raise again.
  connection: { statement_timeout: 15000 },
};

/** slot -> { client, handle }. Two slots, created lazily and independently. */
const pools = { request: {}, loader: {} };

/** The live client for one slot, created on first use. Null without a URL. */
function liveClient(slot) {
  if (!process.env.DATABASE_URL) return null;
  pools[slot].client ??= postgres(process.env.DATABASE_URL, CLIENT_OPTIONS);
  return pools[slot].client;
}

function requireClient(slot) {
  const live = liveClient(slot);
  if (!live) throw new Error("DATABASE_URL is not configured");
  return live;
}

/**
 * A STABLE handle over a slot's client, not the client itself.
 *
 * Everything that touches Postgres captures this once — createRadarRepository
 * stores it for the life of the repository object — and then queries through it
 * later, sometimes much later. A reset can fire in between: a repository built
 * for a rebuild, then a bounded loader that blows its 2s budget and destroys a
 * client, then the rebuild's first query — on a client that no longer exists.
 * That threw CONNECTION_DESTROYED, which withDbRetry retried against the SAME
 * dead object, and /api/radar turned into a 502. Exactly the launch-hour path:
 * a brand-new league has no snapshot yet, so every cold request rebuilds.
 *
 * Resolving the client per call instead of per capture removes that class: a
 * destroyed client is never handed out again, and the next query opens a fresh
 * connection the way a warm instance's first query already does.
 *
 * Chosen over the alternatives because it is the smallest change that is also
 * global: teaching withDbRetry to re-acquire between attempts would mean every
 * one of its ~20 call sites handing it a repository FACTORY rather than a
 * closure (and would not help the first attempt at all), and an in-flight
 * counter in the reset does not help here either — the rebuild holds a
 * reference, not an in-flight query, at the moment the loader times out.
 *
 * KNOWN GAP, deliberate: a callable postgres.js helper that carries its own
 * properties is reached through `bind`, so own properties are re-attached below
 * but their identity is not stable across accesses. Nothing in this repo
 * compares handle properties by identity, and `sql.types` / `sql.typed` — the
 * only such helpers postgres.js ships — are not used anywhere here.
 */
function handleFor(slot) {
  if (!process.env.DATABASE_URL) return null;
  pools[slot].handle ??= new Proxy(function sql() {}, {
    apply: (_target, _thisArg, args) => Reflect.apply(requireClient(slot), undefined, args),
    get: (_target, prop) => {
      const live = requireClient(slot);
      const value = live[prop];
      if (typeof value !== "function") return value;
      // Keep own properties (a callable helper with attached members) rather
      // than dropping them on the floor the way a bare bind would.
      return Object.assign(value.bind(live), value);
    },
    has: (_target, prop) => prop in requireClient(slot),
  });
  return pools[slot].handle;
}

/** The request/cron client handle: routes, rebuilds, snapshots, ingest. */
export function getSql() {
  return handleFor("request");
}

/**
 * The bounded-loader client handle. ONLY identity-overrides.js and
 * default-league.js may use this — see the two-client note above. Anything else
 * belongs on getSql(), or it inherits a 2s destroy budget it did not ask for.
 */
export function getLoaderSql() {
  return handleFor("loader");
}

async function resetSlot(slot, timeout) {
  const stale = pools[slot].client;
  pools[slot].client = undefined;
  if (stale) await stale.end({ timeout });
}

/**
 * Destroy the cached request client after an operation timeout. Promise.race by
 * itself only rejects the caller; postgres.js may otherwise keep the underlying
 * query, transaction, and sole max:1 connection alive until Vercel kills the
 * function.
 *
 * The handle returned by getSql() deliberately survives this: holders keep a
 * working reference and simply resolve the next client on their next query.
 */
export async function resetSql({ timeout = 0 } = {}) {
  await resetSlot("request", timeout);
}

/** The same, for the loaders' own client. Never touches the request client. */
export async function resetLoaderSql({ timeout = 0 } = {}) {
  await resetSlot("loader", timeout);
}

// Transient CONNECTION failures we retry: a warm instance's cached client can
// hold a connection the Supavisor pooler has already dropped (idle_timeout), so
// the first query throws before postgres.js transparently reconnects. Retrying
// the operation lands on the fresh connection. Also covers connection-establish
// timeouts (CONNECT_TIMEOUT / ETIMEDOUT) and server shutdown/failure codes.
//
// Deliberately NOT retried: a *statement* timeout (Postgres 57014, "canceling
// statement due to statement timeout"). That means the query itself is too slow
// — retrying just fires the same doomed query again and piles load on the DB.
// The fix for slow queries is an index, not a retry (see readCandleWindow).
const RETRYABLE_DB_ERROR =
  /CONNECTION_CLOSED|CONNECTION_ENDED|CONNECTION_DESTROYED|CONNECT_TIMEOUT|ECONNRESET|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|57P01|08006|08003|08001/i;

/**
 * Run a database operation, retrying once on a transient connection error.
 * The retry reuses the module-cached client, which reconnects on the next query
 * — so attempt two typically succeeds on a warm connection instead of surfacing
 * a 502. Query errors (bad SQL, constraint violations, statement timeouts)
 * propagate immediately.
 */
export async function withDbRetry(fn, { attempts = 2, delayMs = 150 } = {}) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const text = `${error?.code ?? ""} ${error?.message ?? ""}`;
      if (i === attempts - 1 || !RETRYABLE_DB_ERROR.test(text)) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs * (i + 1)));
    }
  }
  throw lastError;
}
