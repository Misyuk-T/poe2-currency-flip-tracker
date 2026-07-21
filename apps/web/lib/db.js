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

export function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (!client) {
    client = postgres(url, {
      prepare: false, // required for Supavisor transaction pooling
      ssl: "require",
      max: 1, // one connection per warm instance; the pooler fans out concurrency
      idle_timeout: 20,
      connect_timeout: 10,
      connection: { statement_timeout: 8000 },
    });
  }
  return client;
}

/**
 * Destroy the cached client after an operation timeout. Promise.race by itself
 * only rejects the caller; postgres.js may otherwise keep the underlying query,
 * transaction, and sole max:1 connection alive until Vercel kills the function.
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
