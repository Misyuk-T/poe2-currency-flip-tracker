/**
 * The loader/connection cascade that turned /api/radar into a 502.
 *
 * apps/web/lib/db.js pools ONE connection per warm lambda (max: 1) and hands it
 * out as a module singleton. The bounded loaders on the request path — identity
 * overrides, league metadata — run with `opTimeoutMs: 2_000, attempts: 1` and
 * destroy that shared client when their budget is blown (`onTimeout: resetSql`).
 *
 * getRadar's REBUILD path captures its repository BEFORE those loaders run. So a
 * loader timeout destroyed the very client the in-flight rebuild was about to
 * query: CONNECTION_DESTROYED, which is retryable, so withDbRetry fired again at
 * the same dead object, threw, and app/api/radar/route.js returned a 502.
 *
 * It matters on a league launch: a brand-new league has no stored snapshot until
 * the first hourly cron, so launch-hour traffic takes exactly this path, on cold
 * instances, all at once.
 *
 * These tests drive the real getRadar/getHotlist with the real db.js and the
 * real repository, over a fake `postgres` driver installed via
 * module.registerHooks. Nothing here opens a socket or touches a database; the
 * only timing is the loaders' own 2s budget, tripped by a read the fake never
 * answers.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const FAKE_DRIVER = new URL("./fixtures/fake-postgres.js", import.meta.url).href;

const control = {
  clients: [],
  queries: [],
  /** cx_identity reads hang, standing in for a cold connect / cold plan / pooler queue. */
  stallIdentityRead: true,
  answer(text) {
    if (text.includes("from cx_identity")) {
      return this.stallIdentityRead ? new Promise(() => {}) : [];
    }
    if (text.includes("insert into radar_snapshots")) return { count: 1 };
    // league_meta, radar_snapshots and hourly_market_candles reads: no rows.
    // An empty candle window still builds a well-formed (empty) radar payload,
    // and an empty radar_snapshots read is what forces the rebuild path.
    return [];
  },
};
globalThis.__fakePostgres = control;

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "postgres") return { url: FAKE_DRIVER, shortCircuit: true };
    return next(specifier, context);
  },
});

// Must be set before db.js is imported: it reads DATABASE_URL on every call, but
// a missing one short-circuits getSql() to null and skips the database entirely.
process.env.DATABASE_URL = "postgres://fake/fake";

const { getSql, resetSql } = await import("../apps/web/lib/db.js");
const { getRadar, getHotlist } = await import("../apps/web/lib/radar-backend.js");
const { resetIdentityOverridesCache } = await import("../apps/web/lib/identity-overrides.js");
const { resetLeagueMetaCache } = await import("../apps/web/lib/default-league.js");

/** Everything observed since the last coldInstance(). */
let mark = { queries: 0, clients: 0 };
const since = () => ({
  queries: control.queries.slice(mark.queries),
  clients: control.clients.slice(mark.clients),
});
const identityReads = () => since().queries.filter((q) => q.includes("from cx_identity")).length;

/** A cold lambda: no cached client, no cached loader answers. */
async function coldInstance() {
  await resetSql({ timeout: 0 });
  resetIdentityOverridesCache();
  resetLeagueMetaCache();
  mark = { queries: control.queries.length, clients: control.clients.length };
}

test("a destroyed client never reaches a holder that captured the handle earlier", async () => {
  await coldInstance();
  const sql = getSql(); // captured once, exactly as createRadarRepository captures it
  await sql`select 1`;
  const captured = since().clients.at(-1);

  // What a loader's onTimeout does.
  await resetSql({ timeout: 0 });
  assert.equal(captured.destroyed, true);

  // Before the fix this threw CONNECTION_DESTROYED, because the holder was
  // pinned to the client it captured. It must transparently reconnect instead.
  await sql`select 1`;
  const reconnected = since().clients.at(-1);
  assert.notEqual(reconnected, captured, "the next query opens a fresh connection");
  assert.equal(reconnected.destroyed, false);
});

test("getRadar's rebuild survives a loader that blows its budget mid-request", async () => {
  await coldInstance();
  control.stallIdentityRead = true;

  // No snapshot rows, so this is the rebuild path — launch hour for a league the
  // hourly cron has not covered yet.
  const radar = await getRadar(new URLSearchParams("anchor=exalted"));

  assert.equal(radar.status, 200, "the rebuild must not surface as a 502");
  assert.equal(radar.body.game, "poe2");
  assert.ok(Array.isArray(radar.body.rows));
  // The rebuild renders from the committed catalog only: the cron's own build
  // loads identity overrides, so the snapshot that replaces this payload carries
  // them. Nothing on the request path may spend a database read — or the shared
  // connection's life — to decorate names here.
  assert.equal(identityReads(), 0, "the rebuild path must not read cx_identity at all");
});

test("a loader timeout on a path that keeps its loader degrades without killing the request", async () => {
  await coldInstance();
  control.stallIdentityRead = true;

  // getHotlist has no snapshot short circuit to sit below, so it keeps the
  // identity read — and it, too, captures its repository BEFORE the read. The
  // loader still blows its 2s budget and still calls resetSql; the request must
  // survive on a fresh connection rather than 500 on a destroyed one.
  const hotlist = await getHotlist(new URLSearchParams());

  assert.equal(hotlist.status, 200);
  assert.equal(hotlist.body.game, "poe2");
  assert.ok(identityReads() >= 1, "getHotlist still attempts the identity read");
  const clients = since().clients;
  assert.equal(clients[0].destroyed, true, "the loader timeout did destroy the shared client");
  assert.ok(clients.length >= 2, "and the rest of the request ran on a fresh connection");
});
