/**
 * Minimal stand-in for the `postgres` package.
 *
 * test/loader-connection-cascade.test.js installs it in place of the real driver
 * (module.registerHooks, no flags) BEFORE apps/web/lib/db.js is imported, so the
 * production request path — db.js, createRadarRepository, withDbRetry, the
 * loaders, getRadar — runs unmodified against a client whose timing and
 * lifecycle the test controls. No socket is opened and no database is reached.
 *
 * Control surface, `globalThis.__fakePostgres`:
 *   clients — every client handed out, in creation order (a destroyed one is
 *             never reused, so this doubles as a reconnect counter)
 *   queries — every statement issued, across clients, in order
 *   answer  — (text, client) => rows | Promise<rows>; the test's query router
 */
export default function postgres(url, options = {}) {
  const control = globalThis.__fakePostgres;
  const client = { url, options, destroyed: false, queries: [] };
  control.clients.push(client);

  const run = (text) => {
    client.queries.push(text);
    control.queries.push(text);
    if (client.destroyed) {
      // How postgres.js reports a query issued after end(): db.js's
      // RETRYABLE_DB_ERROR matches the code, so withDbRetry retries it.
      const error = new Error("write CONNECTION_DESTROYED");
      error.code = "CONNECTION_DESTROYED";
      return Promise.reject(error);
    }
    return Promise.resolve(control.answer(text, client));
  };

  // Tagged template => a query. Called with anything else it is the value
  // fragment form, `sql(rows)`, which never has to execute here.
  const sql = (strings, ...values) =>
    Array.isArray(strings) ? run(strings.join(" ? ")) : { fragment: strings, values };
  sql.json = (value) => ({ json: value });
  sql.array = (value) => ({ array: value });
  sql.unsafe = (text) => run(String(text));
  sql.begin = async (fn) => fn(sql);
  sql.end = async () => {
    client.destroyed = true;
  };
  return sql;
}
