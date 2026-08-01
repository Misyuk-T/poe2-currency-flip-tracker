import test from "node:test";
import assert from "node:assert/strict";

import { createRadarRepository, candleFromRow, groupCandlesByPair } from "../src/storage/radar-repository.js";

const scope = { game: "poe2", realm: "poe2", league: "Runes of Aldur", mode: "fixture" };

/** Minimal postgres.js stand-in: each tagged-template call shifts a result. */
function fakeSql(results) {
  let i = 0;
  return (..._args) => Promise.resolve(results[i++] ?? []);
}

const candleRow = {
  completed_hour: 1_700_000_000_000,
  digest_id: "472222",
  pair_id: "divine|exalted",
  base_currency: "divine",
  quote_currency: "exalted",
  low_ratio: 200,
  high_ratio: 220,
  reference_ratio: 210,
  reference_kind: "range-midpoint-proxy",
  volume: '{"divine":5,"exalted":1000}', // JSON string, as Postgres may return jsonb
  stock: "{}",
  source: "ggg-cxapi",
};

test("candleFromRow maps DB columns, parses JSON, and preserves nulls", () => {
  const candle = candleFromRow(candleRow, { league: scope.league });
  assert.equal(candle.league, scope.league);
  assert.equal(candle.completedHour, 1_700_000_000_000);
  assert.equal(candle.digestId, 472222);
  assert.equal(candle.base, "divine");
  assert.equal(candle.quote, "exalted");
  assert.equal(candle.reference, 210);
  assert.deepEqual(candle.volume, { divine: 5, exalted: 1000 });
  assert.deepEqual(candle.stock, {});

  const sparse = candleFromRow({ ...candleRow, low_ratio: null, high_ratio: null, reference_ratio: null, volume: { a: 1 } });
  assert.equal(sparse.low, null);
  assert.equal(sparse.reference, null);
  assert.deepEqual(sparse.volume, { a: 1 }); // already-parsed jsonb passes through
});

test("groupCandlesByPair buckets by pair and sorts each by completed hour", () => {
  const byPair = groupCandlesByPair([
    { pairId: "a|b", completedHour: 30 },
    { pairId: "a|b", completedHour: 10 },
    { pairId: "c|d", completedHour: 20 },
    { pairId: "a|b", completedHour: 20 },
  ]);
  assert.deepEqual(Object.keys(byPair).sort(), ["a|b", "c|d"]);
  assert.deepEqual(byPair["a|b"].map((c) => c.completedHour), [10, 20, 30]);
  assert.equal(byPair["c|d"].length, 1);
});

test("createRadarRepository validates its dependencies", () => {
  assert.throws(() => createRadarRepository({ sql: null, scope }), /sql client/);
  assert.throws(() => createRadarRepository({ sql: fakeSql([]), scope: null }), /scope/);
});

test("readCandleWindow returns mapped candles for the scope", async () => {
  const repo = createRadarRepository({ sql: fakeSql([[candleRow]]), scope });
  const candles = await repo.readCandleWindow();
  assert.equal(candles.length, 1);
  assert.equal(candles[0].pairId, "divine|exalted");
  assert.equal(candles[0].reference, 210);
});

test("hasPricedCandles returns the lightweight league availability flag", async () => {
  const available = createRadarRepository({ sql: fakeSql([[{ available: true }]]), scope });
  assert.equal(await available.hasPricedCandles(), true);

  const empty = createRadarRepository({ sql: fakeSql([[{ available: false }]]), scope });
  assert.equal(await empty.hasPricedCandles(), false);
});

test("listPricedLeagues discovers recent priced scopes in freshness order", async () => {
  const repo = createRadarRepository({
    sql: fakeSql([[
      { league: "Runes of Aldur", newest_completed_hour: "1785603600000" },
      { league: "Standard", newest_completed_hour: "1785600000000" },
    ]]),
    scope,
  });
  assert.deepEqual(await repo.listPricedLeagues(), [
    { league: "Runes of Aldur", newestCompletedHour: 1_785_603_600_000 },
    { league: "Standard", newestCompletedHour: 1_785_600_000_000 },
  ]);
});

test("readRadarSnapshot parses a stored JSON payload and refresh time", async () => {
  const repo = createRadarRepository({
    sql: fakeSql([[{ payload: '{"anchor":"exalted","rows":[]}', refreshed_at: "1700000000000" }]]),
    scope,
  });
  assert.deepEqual(await repo.readRadarSnapshot("exalted"), {
    payload: { anchor: "exalted", rows: [] },
    refreshedAt: 1_700_000_000_000,
  });
});

test("writeRadarSnapshots uses postgres.js JSON serialization, not a JSON string scalar", async () => {
  const serialized = [];
  const sql = (..._args) => Promise.resolve({ count: 1 });
  sql.json = (value) => {
    serialized.push(value);
    return value;
  };
  const repo = createRadarRepository({ sql, scope });
  const payload = {
    anchor: "exalted",
    generatedAt: "2026-07-28T07:00:00.000Z",
    rows: [{ latestCompletedHour: 1_785_218_400_000 }],
  };
  assert.equal(await repo.writeRadarSnapshots([{ anchor: "exalted", payload }]), 1);
  assert.equal(serialized[0], payload);
  assert.equal(typeof serialized[0], "object");
});

test("readCxapiState parses the cursor, or reports null when absent", async () => {
  const present = createRadarRepository({ sql: fakeSql([[{ next_change_id: "100", last_digest_id: "99" }]]), scope });
  assert.deepEqual(await present.readCxapiState(), { cursor: 100, lastDigestId: 99 });

  const absent = createRadarRepository({ sql: fakeSql([[]]), scope });
  assert.deepEqual(await absent.readCxapiState(), { cursor: null, lastDigestId: null });
});

test("the radar read looks back seven days and caps each pair at 25 hours", () => {
  // The per-pair cap means this read never uses more than 25 hours of any pair,
  // but the pair-discovery scan used to span a long retention. On the
  // busiest league that crossed the statement timeout and the hourly snapshot
  // rebuild failed every hour — while every smaller league succeeded, so it read
  // as a data problem rather than a query that had outgrown its window.
  const calls = [];
  const sql = (strings, ...values) => {
    calls.push({ text: strings.join("?"), values });
    return Promise.resolve([]);
  };
  const repo = createRadarRepository({ sql, scope, anchors: ["exalted", "divine"] });
  return repo.readCandleWindow().then(() => {
    const { text, values } = calls[0];
    const days = values.filter((value) => value === 7 || value === 30);
    assert.equal(days.length, 2, "both the discovery scan and the lateral take a window");
    assert.deepEqual(days, [7, 7], "the radar read must not scan the retention window");
    assert.ok(values.includes(25), "the radar read keeps only the 25 points used by 24h metrics");
    assert.equal(
      values.filter((value) => Array.isArray(value) && value.join(",") === "exalted,divine").length,
      4,
      "pair discovery and row reads both filter base and quote to configured anchors",
    );
    assert.match(text, /cross join lateral/i);
    assert.doesNotMatch(text, /\bstock\b/i, "unused stock JSON must not leave Supabase");
    assert.doesNotMatch(text, /reference_ratio/i, "the geometric centre is recomputed from low/high");
  });
});

test("per-pair history spans the seven-day Free-plan retention window", () => {
  const calls = [];
  const sql = (strings, ...values) => {
    calls.push(values);
    return Promise.resolve([]);
  };
  const repo = createRadarRepository({ sql, scope });
  return repo.readPairCandles("divine|exalted").then(() => {
    assert.ok(calls[0].includes(7), "readPairCandles should match the seven-day retention");
  });
});
