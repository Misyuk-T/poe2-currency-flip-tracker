/**
 * The loader/connection cascade that turned /api/radar into a 502.
 *
 * apps/web/lib/db.js pools ONE connection per warm lambda (max: 1). The bounded
 * loaders on the request path — identity overrides, league metadata — run with
 * `opTimeoutMs: 2_000, attempts: 1` and destroy their client when that budget is
 * blown. They used to share the client with everything else, and getRadar's
 * REBUILD path captures its repository BEFORE they run. So a loader timeout
 * destroyed the very client the in-flight rebuild was about to query:
 * CONNECTION_DESTROYED, which is retryable, so withDbRetry fired again at the
 * same dead object, threw, and app/api/radar/route.js returned a 502.
 *
 * It matters on a league launch: a brand-new league has no stored snapshot until
 * the first hourly cron, so launch-hour traffic takes exactly this path, on cold
 * instances, all at once.
 *
 * These tests drive the real getRadar/getHotlist with the real db.js and the
 * real repository, over a fake `postgres` driver installed via
 * module.registerHooks (Node >= 22.15). Nothing here opens a socket or touches a
 * database; the only timing is the loaders' own 2s budget, tripped by a read the
 * fake never answers.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const FAKE_DRIVER = new URL("./fixtures/fake-postgres.js", import.meta.url).href;

const HOUR = 3_600_000;
const OVERRIDE_ID = "Metadata/Items/Currency/CurrencyPeekedThing";
// A long-tail id the committed catalog does not answer — the case identity
// overrides exist for, and the one a rebuild degrades.
const TAIL = "peeked-thing";

/** 26 hourly candles for one market, so a rebuild has something real to render. */
const candleRows = () => {
  const latest = Math.floor(Date.now() / HOUR) * HOUR;
  return Array.from({ length: 26 }, (_, i) => ({
    completed_hour: latest - (25 - i) * HOUR,
    pair_id: `exalted|${TAIL}`,
    base_currency: TAIL,
    quote_currency: "exalted",
    low_ratio: 100 + i,
    high_ratio: 110 + i,
    reference_ratio: 105 + i,
    reference_kind: "mid",
    volume: { base: 10, quote: 1000 },
  }));
};

const control = {
  clients: [],
  queries: [],
  statements: [],
  /** cx_identity reads hang, standing in for a cold connect / cold plan / pooler queue. */
  stallIdentityRead: true,
  identityRows: [],
  /** Set while an in_flight_probe query is parked; calling it releases the query. */
  release: null,
  answer(text) {
    if (text.includes("in_flight_probe")) {
      return new Promise((resolve) => {
        this.release = () => resolve([{ ok: true }]);
      });
    }
    if (text.includes("from cx_identity")) {
      return this.stallIdentityRead ? new Promise(() => {}) : this.identityRows;
    }
    if (text.includes("insert into radar_snapshots")) return { count: 1 };
    // The radar's candle window is the one hourly_market_candles read that wants
    // rows; the availability probes want their own shapes and get none.
    if (text.includes("cross join lateral")) return candleRows();
    // league_meta and radar_snapshots reads: no rows. An empty radar_snapshots
    // read is what forces getRadar down the rebuild path.
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

const { getSql, resetSql, resetLoaderSql } = await import("../apps/web/lib/db.js");
const { getRadar, getHotlist } = await import("../apps/web/lib/radar-backend.js");
const identityOverrides = await import("../apps/web/lib/identity-overrides.js");
const { resetLeagueMetaCache } = await import("../apps/web/lib/default-league.js");

/** Everything observed since the last coldInstance(). */
let mark = { queries: 0, clients: 0, statements: 0 };
const since = () => ({
  queries: control.queries.slice(mark.queries),
  clients: control.clients.slice(mark.clients),
  statements: control.statements.slice(mark.statements),
});
const identityReads = () => since().queries.filter((q) => q.includes("from cx_identity")).length;
const ran = (client, needle) => client.queries.some((query) => query.includes(needle));

/** A cold lambda: no cached clients, no cached loader answers. */
async function coldInstance() {
  await resetSql({ timeout: 0 });
  await resetLoaderSql({ timeout: 0 });
  identityOverrides.resetIdentityOverridesCache();
  resetLeagueMetaCache();
  control.stallIdentityRead = true;
  control.identityRows = [];
  control.release = null;
  mark = {
    queries: control.queries.length,
    clients: control.clients.length,
    statements: control.statements.length,
  };
}

test("a destroyed client never reaches a holder that captured the handle earlier", async () => {
  await coldInstance();
  const sql = getSql(); // captured once, exactly as createRadarRepository captures it
  await sql`select 1`;
  const captured = since().clients.at(-1);

  // What an operation timeout does.
  await resetSql({ timeout: 0 });
  assert.equal(captured.destroyed, true);

  // Before the fix this threw CONNECTION_DESTROYED, because the holder was
  // pinned to the client it captured. It must transparently reconnect instead.
  await sql`select 1`;
  const reconnected = since().clients.at(-1);
  assert.notEqual(reconnected, captured, "the next query opens a fresh connection");
  assert.equal(reconnected.destroyed, false);
});

test("the handle forwards value fragments and transactions, across a reset", async () => {
  await coldInstance();
  const sql = getSql();
  const batch = [{ a: 1 }, { a: 2 }];

  // sql(rows) inside a tagged template, and sql.begin — the two shapes ingest
  // and /api/cron/identity depend on, neither of which is a plain query.
  const outcome = await sql.begin(async (tx) => {
    await tx`insert into hourly_market_candles ${tx(batch)} on conflict do nothing`;
    return "committed";
  });
  assert.equal(outcome, "committed");

  const first = since().clients.at(-1);
  assert.equal(first.transactions, 1);
  const insert = since().statements.find((s) => s.text.includes("insert into hourly_market_candles"));
  assert.equal(insert.tx, true, "the insert ran inside the transaction, on one connection");
  assert.deepEqual(insert.values[0], { builder: batch, rest: [] }, "sql(rows) reached the driver");
  assert.deepEqual(
    since().queries.filter((q) => q === "begin" || q === "commit"),
    ["begin", "commit"],
  );

  // Same handle, new client underneath: both shapes must still work.
  await resetSql({ timeout: 0 });
  await sql.begin(async (tx) => tx`insert into hourly_market_candles ${tx(batch)}`);
  const second = since().clients.at(-1);
  assert.notEqual(second, first);
  assert.equal(second.transactions, 1);
  assert.equal(second.destroyed, false);
});

test("getRadar's rebuild survives a loader that blows its budget mid-request", async () => {
  await coldInstance();

  // No snapshot rows, so this is the rebuild path — launch hour for a league the
  // hourly cron has not covered yet.
  const radar = await getRadar(new URLSearchParams("anchor=exalted"));

  assert.equal(radar.status, 200, "the rebuild must not surface as a 502");
  assert.equal(radar.body.game, "poe2");
  assert.ok(radar.body.rows.length > 0, "the rebuild rendered the candle window");
  // A cold instance has nothing cached, and the rebuild may not go and get it:
  // this is the slowest request path there is, and the cron's own build applies
  // identity to the snapshot that replaces this payload. The long-tail row is
  // therefore undecorated here, which is the accepted cost.
  assert.equal(identityReads(), 0, "the rebuild path must never issue an identity read");
  assert.equal(radar.body.rows.find((row) => row.target === TAIL).targetName, TAIL);
  assert.ok(
    since().clients.every((client) => !client.destroyed),
    "and nothing destroyed a connection out from under it",
  );
});

test("a warm identity cache is used by the rebuild, without a read", async () => {
  await coldInstance();
  control.stallIdentityRead = false;
  control.identityRows = [
    {
      metadata_id: OVERRIDE_ID,
      name: "Peeked Orb",
      icon: "https://example.test/peeked.png",
      category: "Currency",
      subcategory: null,
      short_id: TAIL,
      source: "repoe-catalog",
      resolved_at: 1,
      updated_at: 1,
    },
  ];

  // Something else on the instance warms the cache first — a hotlist, /api/status
  // or an hourly cron build within the 10-minute TTL. That is the common case.
  await identityOverrides.loadIdentityOverrides("poe2");
  const warmedBy = identityReads();
  assert.equal(warmedBy, 1);

  const radar = await getRadar(new URLSearchParams("anchor=exalted"));
  assert.equal(radar.status, 200);
  assert.equal(identityReads(), warmedBy, "the rebuild added no identity read of its own");

  // The overrides carry `category` as well as name and icon — and this payload
  // is persisted as a snapshot below, so losing them would outlive the cron run
  // that should have fixed it.
  const tail = radar.body.rows.find((row) => row.target === TAIL);
  assert.equal(tail.targetName, "Peeked Orb");
  assert.equal(tail.targetIcon, "https://example.test/peeked.png");
  assert.equal(tail.tradeCategory, "Currency");
  // Honest limit: the wire-level `category`/`subcategory` come from the game
  // client exchange layout, not from identity, so an id the layout does not know
  // still reads "Needs classification" either way. What the peek buys back is
  // the name, the icon and the trade category.
  assert.equal(tail.category, "Needs classification");
});

test("a loader timeout cannot abort work already in flight on the request client", async () => {
  await coldInstance();
  const sql = getSql();

  // A repository read in flight on the request connection. postgres.js binds a
  // Query to the client that created it and `tx` inside sql.begin is pinned to
  // one connection, so neither can be relocated by the stable handle: only
  // giving the loaders a client of their own keeps this safe. In the same
  // invocation the cron does exactly this — loader work alongside an ingest
  // transaction.
  const inFlight = sql`select 1 from in_flight_probe`;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof control.release, "function", "the request read is parked, not finished");

  // Meanwhile a bounded loader blows its 2s budget and resets.
  await identityOverrides.loadIdentityOverrides("poe2");
  assert.ok(identityReads() >= 1);

  control.release();
  assert.deepEqual(await inFlight, [{ ok: true }], "the in-flight read was never aborted");
});

test("a loader timeout destroys only the loaders' own connection", async () => {
  await coldInstance();

  // getHotlist has no snapshot short circuit to sit below, so it keeps the
  // identity read — and it, too, captures its repository BEFORE the read. The
  // loader still blows its 2s budget and still resets; that must land on the
  // loaders' own client and never on the one doing the work.
  const hotlist = await getHotlist(new URLSearchParams());

  assert.equal(hotlist.status, 200);
  assert.equal(hotlist.body.game, "poe2");
  assert.ok(identityReads() >= 1, "getHotlist still attempts the identity read");

  const clients = since().clients;
  const loaderClient = clients.find((client) => ran(client, "from cx_identity"));
  const workClient = clients.find((client) => ran(client, "hourly_market_candles"));
  assert.ok(loaderClient && workClient);
  assert.notEqual(loaderClient, workClient, "loaders run on a connection of their own");
  assert.equal(loaderClient.destroyed, true, "the timeout destroyed the loaders' client");
  assert.equal(workClient.destroyed, false, "and left the request's connection alone");
});
