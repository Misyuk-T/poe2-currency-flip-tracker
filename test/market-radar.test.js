import test from "node:test";
import assert from "node:assert/strict";
import { buildCxapiFixtures } from "../src/data/fixtures/cxapi-fixtures.js";
import { normalizeCxDigest } from "../src/domain/cx-market.js";
import { buildMarketRadar } from "../src/domain/market-radar.js";
import { buildHotlist } from "../src/domain/hotlist.js";

function fixtureCandles() {
  const all = {};
  for (const d of buildCxapiFixtures({ league: "L" })) {
    for (const c of normalizeCxDigest(d.payload, { digestId: d.digestId, league: "L" }).candles) {
      (all[c.pairId] ??= []).push(c);
    }
  }
  return all;
}

test("radar computes descriptive 3/6/12/24h movement, volume and scores", () => {
  const all = fixtureCandles();
  const latest = Math.max(...Object.values(all).flat().map((c) => c.completedHour));
  const rows = buildMarketRadar(all, { anchor: "exalted", now: latest + 3600_000 });
  const divine = rows.find((r) => r.target === "divine");
  assert.equal(divine.status, "ok");
  assert.ok(Number.isFinite(divine.movement.h6));
  assert.ok(Number.isFinite(divine.movement.h1));
  assert.ok(Number.isFinite(divine.movement.h24));
  assert.ok(Number.isFinite(divine.volumeAcceleration));
  assert.ok(divine.activityScore >= 0 && divine.activityScore <= 100);
  assert.ok(divine.arbitrageScore >= 0 && divine.arbitrageScore <= 100);
  assert.equal(divine.sparkline24h.length, 25);
  assert.ok(divine.sparkline24h.every(Number.isFinite));
});

test("one-hour movement needs two completed hourly observations", () => {
  const all = fixtureCandles();
  const pair = Object.keys(all)[0];
  const one = { [pair]: all[pair].slice(-1) };
  const row = buildMarketRadar(one, { anchor: "exalted" })[0];
  assert.equal(row.movement.h1, null);
});

test("a young market publishes no 24h movement, and does not fake one from three candles", () => {
  // The launch-league case: eight consecutive hourly candles. Enough to count,
  // nowhere near a day of span, so h24/h12 are null while h6 and h1 are real.
  const all = fixtureCandles();
  const pair = Object.keys(all).find((id) => all[id].length >= 8);
  const young = { [pair]: all[pair].slice(-8) };
  const row = buildMarketRadar(young, { anchor: "exalted" })[0];
  assert.equal(row.movement.h24, null, "h24 over an 8h span must not be published");
  assert.equal(row.movement.h12, null, "h12 over an 8h span must not be published");
  assert.ok(Number.isFinite(row.movement.h6), "h6 is fully spanned and must survive");
  assert.ok(Number.isFinite(row.movement.h1));
  // The scores keep their pre-existing input, so blanking the published number
  // does not silently re-rank a sparse market as motionless-and-therefore-calm.
  assert.ok(row.activityScore > 0);
  assert.ok(row.arbitrageScore > 0);
});

test("a sparse 24h window is not published as a 24h change", () => {
  // Three candles inside the window but only two hours apart — the exact shape
  // the count check alone used to accept.
  const all = fixtureCandles();
  const pair = Object.keys(all).find((id) => all[id].length >= 25);
  const series = all[pair].slice(-25);
  const sparse = { [pair]: [series[0], ...series.slice(-3)] };
  const row = buildMarketRadar(sparse, { anchor: "exalted" })[0];
  assert.ok(Number.isFinite(row.movement.h24), "a 24h-old first sample still qualifies");
  const tooRecent = { [pair]: series.slice(-3) };
  assert.equal(buildMarketRadar(tooRecent, { anchor: "exalted" })[0].movement.h24, null);
});

test("radar rows carry game-scoped identity art and category", () => {
  const all = fixtureCandles();
  const row = buildMarketRadar(all, {
    anchor: "exalted",
    icons: { divine: "https://web.poecdn.com/image/Art/example.png?scale=1" },
    categories: { divine: "StackableCurrency" },
  }).find((entry) => entry.target === "divine");
  assert.equal(row.targetIcon, "https://web.poecdn.com/image/Art/example.png?scale=1");
  assert.equal(row.category, "StackableCurrency");
});

test("hotlist keeps pinned items and applies minimum tenure hysteresis", () => {
  const radar = [{ target: "mover", status: "ok", stale: false, activityScore: 90, arbitrageScore: 20 }];
  const first = buildHotlist({ pinned: ["divine"], radar, maxTargets: 2, now: 1000 });
  assert.deepEqual(first.map((x) => x.id), ["divine", "mover"]);
  const retained = buildHotlist({ pinned: ["divine"], radar: [], previous: first, maxTargets: 2, now: 2000, minTenureMs: 5000 });
  assert.deepEqual(retained.map((x) => x.id), ["divine", "mover"]);
});
