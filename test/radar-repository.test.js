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

test("readCxapiState parses the cursor, or reports null when absent", async () => {
  const present = createRadarRepository({ sql: fakeSql([[{ next_change_id: "100", last_digest_id: "99" }]]), scope });
  assert.deepEqual(await present.readCxapiState(), { cursor: 100, lastDigestId: 99 });

  const absent = createRadarRepository({ sql: fakeSql([[]]), scope });
  assert.deepEqual(await absent.readCxapiState(), { cursor: null, lastDigestId: null });
});
