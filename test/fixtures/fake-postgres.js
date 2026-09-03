/**
 * Minimal stand-in for the `postgres` package.
 *
 * test/loader-connection-cascade.test.js installs it in place of the real driver
 * (module.registerHooks, no flags) BEFORE apps/web/lib/db.js is imported, so the
 * production request path — db.js, createRadarRepository, withDbRetry, the
 * loaders, getRadar — runs unmodified against clients whose timing and lifecycle
 * the test controls. No socket is opened and no database is reached.
 *
 * It models the three call shapes db.js's Proxy handle has to forward, because
 * ingest and /api/cron/identity depend on all three:
 *   sql`...`        tagged template  -> a query
 *   sql(rows)       value fragment   -> a Builder, interpolated into a query
 *   sql.begin(fn)   transaction      -> `tx` pinned to the SAME client
 *
 * Control surface, `globalThis.__fakePostgres`:
 *   clients    — every client handed out, in creation order (a destroyed one is
 *                never reused, so this doubles as a reconnect counter)
 *   queries    — every statement's text, across clients, in order
 *   statements — the same, with { text, values, client, tx }
 *   answer     — (text, client) => rows | Promise<rows>; the test's query router
 */
export default function postgres(url, options = {}) {
  const control = globalThis.__fakePostgres;
  const client = { url, options, destroyed: false, queries: [], transactions: 0, pending: [] };
  control.clients.push(client);

  // How postgres.js reports a query issued after — or interrupted by — end().
  // db.js's RETRYABLE_DB_ERROR matches the code, so withDbRetry retries it.
  const destroyed = () => Object.assign(new Error("write CONNECTION_DESTROYED"), {
    code: "CONNECTION_DESTROYED",
  });

  const run = (text, values, tx) => {
    client.queries.push(text);
    control.queries.push(text);
    control.statements.push({ text, values, client, tx });
    if (client.destroyed) return Promise.reject(destroyed());
    // A query already in flight dies with its connection, exactly as it does
    // against the real driver — which is the whole reason the bounded loaders
    // need a client of their own rather than a relocatable handle.
    return new Promise((resolve, reject) => {
      const settled = { reject };
      client.pending.push(settled);
      const done = () => {
        const at = client.pending.indexOf(settled);
        if (at >= 0) client.pending.splice(at, 1);
      };
      Promise.resolve(control.answer(text, client)).then(
        (rows) => { done(); resolve(rows); },
        (error) => { done(); reject(error); },
      );
    });
  };

  /**
   * Called with a template strings array it is a query; called with anything
   * else it is the value-fragment form `sql(rows)` / `sql("column")`, which the
   * real driver compiles into whatever query interpolates it.
   */
  const clientSql = (tx) => {
    const sql = (strings, ...values) =>
      Array.isArray(strings) && Array.isArray(strings.raw)
        ? run(strings.join(" ? "), values, tx)
        : { builder: strings, rest: values };
    sql.json = (value) => ({ json: value });
    sql.array = (value) => ({ array: value });
    sql.unsafe = (text) => run(String(text), [], tx);
    // A transaction is pinned to one connection by definition: `tx` is this same
    // client, which is exactly why a reset during sql.begin cannot be recovered
    // by relocating it — see the two-client note in apps/web/lib/db.js.
    sql.begin = async (fn) => {
      client.transactions += 1;
      await run("begin", [], true);
      const result = await fn(clientSql(true));
      await run("commit", [], true);
      return result;
    };
    sql.end = async () => {
      client.destroyed = true;
      for (const settled of client.pending.splice(0)) settled.reject(destroyed());
    };
    return sql;
  };

  return clientSql(false);
}
