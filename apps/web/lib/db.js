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
