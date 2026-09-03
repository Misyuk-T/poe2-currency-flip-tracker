import postgres from "postgres";

/**
 * Lazily-created, module-cached Postgres client for serverless route handlers.
 * A warm lambda reuses the same client across invocations. Tuned for Supabase's
 * Supavisor transaction pooler (port 6543): prepared statements OFF, a small
 * pool per instance, and a server-side statement timeout.
 *
 * Returns null when DATABASE_URL is absent so routes can degrade to a clean 503
 * instead of throwing at import time (e.g. local dev without a database).
 */
let client;
let handle;

/** The live module-cached client, created on first use. Null without a URL. */
function liveClient() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (!client) {
    client = postgres(url, {
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
    });
  }
  return client;
}

function requireClient() {
  const live = liveClient();
  if (!live) throw new Error("DATABASE_URL is not configured");
  return live;
}

/**
 * A STABLE handle over the module-cached client, not the client itself.
 *
 * Everything that touches Postgres captures this once — createRadarRepository
 * stores it for the life of the repository object — and then queries through it
 * later, sometimes much later. resetSql() can fire in between: a repository
 * built for a rebuild, then a bounded loader (identity overrides, league meta)
 * that blows its 2s budget and destroys the shared max:1 client, then the
 * rebuild's first query — on a client that no longer exists. That threw
 * CONNECTION_DESTROYED, which withDbRetry retried against the SAME dead object,
 * and /api/radar turned into a 502. Exactly the launch-hour path: a brand-new
 * league has no snapshot yet, so every cold request rebuilds.
 *
 * Resolving the client per call instead of per capture removes that whole class:
 * a destroyed client is simply never handed out again, and the next query opens
 * a fresh connection the way a warm instance's first query already does. The
 * only cost is that a reset during an in-flight burst can open one extra
 * connection, which is what the Supavisor pooler is there to absorb.
 *
 * Chosen over the alternatives because it is the smallest change that is also
 * global: teaching withDbRetry to re-acquire between attempts would mean every
 * one of its ~20 call sites handing it a repository FACTORY rather than a
 * closure (and would not help the first attempt at all), and an in-flight
 * counter in resetSql does not help here either — the rebuild holds a reference,
 * not an in-flight query, at the moment the loader times out.
 */
export function getSql() {
  if (!process.env.DATABASE_URL) return null;
  handle ??= new Proxy(function sql() {}, {
    apply: (_target, _thisArg, args) => Reflect.apply(requireClient(), undefined, args),
    get: (_target, prop) => {
      const live = requireClient();
      const value = live[prop];
      return typeof value === "function" ? value.bind(live) : value;
    },
    has: (_target, prop) => prop in requireClient(),
  });
  return handle;
}

/**
 * Destroy the cached client after an operation timeout. Promise.race by itself
 * only rejects the caller; postgres.js may otherwise keep the underlying query,
 * transaction, and sole max:1 connection alive until Vercel kills the function.
 *
 * The handle returned by getSql() deliberately survives this: holders keep a
 * working reference and simply resolve the next client on their next query.
 */
export async function resetSql({ timeout = 0 } = {}) {
  const stale = client;
  client = undefined;
  if (stale) await stale.end({ timeout });
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
