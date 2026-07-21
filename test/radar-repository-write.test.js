import test from "node:test";
import assert from "node:assert/strict";
import { createRadarRepository } from "../src/storage/radar-repository.js";

const scope = { game: "poe2", realm: "poe2", league: "Runes of Aldur", mode: "fixture" };

/**
 * A postgres.js stand-in that supports `sql.begin(fn)` + a `tx` usable both as a
 * tagged template and as `tx(rows)`. Captures each tagged-template call so we can
 * assert the schema contract (per-candle league; league-free stream cursor)
 * WITHOUT a real database — which also guards against an old-code/new-schema
 * deploy mismatch (migration 006).
 */
function fakeTxSql() {
  const templateCalls = [];
  const tx = (first, ...values) => {
    const isTagged = Array.isArray(first) && Object.prototype.hasOwnProperty.call(first, "raw");
    if (!isTagged) return { __fragmentRows: first }; // tx(rows) -> values fragment
    templateCalls.push({ text: first.join(" ? "), values });
    const frag = values.find((v) => v && v.__fragmentRows);
    return Promise.resolve(frag ? { count: frag.__fragmentRows.length } : []);
  };
  return { sql: { begin: (fn) => fn(tx) }, templateCalls };
}

const candle = (league) => ({
  completedHour: 1_700_000_000_000,
  digestId: 472222,
  pairId: "a|b",
  base: "a",
  quote: "b",
  low: 1,
  high: 2,
  reference: 1.5,
  referenceKind: "range-midpoint-proxy",
  volume: {},
  stock: {},
  source: "ggg-cxapi",
  league,
});

test("recordCxDigest stores each candle's OWN league (same pair/hour, two leagues)", async () => {
  const { sql, templateCalls } = fakeTxSql();
  const repo = createRadarRepository({ sql, scope });
  const inserted = await repo.recordCxDigest({
    digestId: 472222,
    nextChangeId: 475822,
    candles: [candle("Standard"), candle("Runes of Aldur")],
  });
  assert.equal(inserted, 2);
  const candleInsert = templateCalls.find((c) => c.text.includes("hourly_market_candles"));
  const rows = candleInsert.values.find((v) => v.__fragmentRows).__fragmentRows;
  assert.deepEqual(rows.map((r) => r.league), ["Standard", "Runes of Aldur"]);
});

test("recordCxDigest cursor upsert is league-free, keyed by (game, realm, provider)", async () => {
  const { sql, templateCalls } = fakeTxSql();
  const repo = createRadarRepository({ sql, scope });
  await repo.recordCxDigest({ digestId: 472222, nextChangeId: 475822, candles: [candle("Standard")] });
  const cursor = templateCalls.find((c) => c.text.includes("cxapi_state"));
  assert.ok(cursor, "cursor upsert issued");
  assert.ok(cursor.text.includes("(game, realm, provider)"), "keyed by the stream, not league");
  assert.ok(!cursor.text.includes("league"), "cursor SQL no longer references league");
  assert.ok(cursor.values.includes(scope.mode), "provider bound");
  assert.ok(!cursor.values.includes(scope.league), "scope league not bound into the cursor");
});

test("recordCxDigest falls back to scope league when a candle omits its own", async () => {
  const { sql, templateCalls } = fakeTxSql();
  const repo = createRadarRepository({ sql, scope });
  const legacy = candle(undefined);
  await repo.recordCxDigest({ digestId: 472222, nextChangeId: 475822, candles: [legacy] });
  const rows = templateCalls
    .find((c) => c.text.includes("hourly_market_candles"))
    .values.find((v) => v.__fragmentRows).__fragmentRows;
  assert.equal(rows[0].league, scope.league);
});

test("recordCxDigest emits transaction/batch phases", async () => {
  const { sql } = fakeTxSql();
  const phases = [];
  const repo = createRadarRepository({ sql, scope, onPhase: (phase) => phases.push(phase) });
  await repo.recordCxDigest({ digestId: 472222, nextChangeId: 475822, candles: [candle("Standard")] });
  assert.deepEqual(phases, [
    "db.transaction.start",
    "db.transaction.acquired",
    "db.transaction.timeouts.start",
    "db.transaction.timeouts.end",
    "db.candles.batch.start",
    "db.candles.batch.end",
    "db.cursor.upsert.start",
    "db.cursor.upsert.end",
    "db.transaction.end",
  ]);
});

test("recordCxDigest timeout invokes client reset hook and reports the failed phase", async () => {
  let timeout;
  const phases = [];
  const sql = { begin: () => new Promise(() => {}) };
  const repo = createRadarRepository({
    sql,
    scope,
    opTimeoutMs: 5,
    onPhase: (phase) => phases.push(phase),
    onTimeout: (details) => { timeout = details; },
  });
  await assert.rejects(
    () => repo.recordCxDigest({ digestId: 472222, nextChangeId: 475822, candles: [] }),
    /recordCxDigest timed out after 5ms/,
  );
  assert.deepEqual(timeout, { label: "recordCxDigest", ms: 5 });
  assert.deepEqual(phases, ["db.transaction.start", "db.transaction.error"]);
});
