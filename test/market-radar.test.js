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

test("hotlist keeps pinned items and applies minimum tenure hysteresis", () => {
  const radar = [{ target: "mover", status: "ok", stale: false, activityScore: 90, arbitrageScore: 20 }];
  const first = buildHotlist({ pinned: ["divine"], radar, maxTargets: 2, now: 1000 });
  assert.deepEqual(first.map((x) => x.id), ["divine", "mover"]);
  const retained = buildHotlist({ pinned: ["divine"], radar: [], previous: first, maxTargets: 2, now: 2000, minTenureMs: 5000 });
  assert.deepEqual(retained.map((x) => x.id), ["divine", "mover"]);
});
