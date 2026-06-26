import test from "node:test";
import assert from "node:assert/strict";
import { selectTopMovers } from "../apps/web/lib/market.js";

const payload = {
  source: { sourceMode: "fixture" },
  rows: [
    { pairId: "exalted|divine", target: "divine", targetName: "Divine Orb", status: "ok", movement: { h24: 0.05 } },
    { pairId: "exalted|chaos", target: "chaos", targetName: "Chaos Orb", status: "ok", movement: { h24: -0.12 } },
    { pairId: "exalted|vaal", target: "vaal", targetName: "Vaal Orb", status: "ok", movement: { h24: 0.01 } },
    { pairId: null, target: "ghost", status: "ok", movement: { h24: 0.99 } }, // no real pair
    { pairId: "exalted|x", target: "x", status: "no-trades-this-hour", movement: { h24: 0.5 } }, // untraded
    { pairId: "exalted|y", target: "y", status: "ok", movement: { h24: null } }, // no movement
  ],
};

test("selectTopMovers ranks tradable rows by absolute 24h move and flags sample data", () => {
  const { movers, sample } = selectTopMovers(payload, { limit: 2 });
  assert.equal(sample, true);
  assert.deepEqual(movers.map((m) => m.target), ["chaos", "divine"]);
});

test("selectTopMovers excludes untradable / no-pair / no-movement rows", () => {
  const { movers } = selectTopMovers(payload, { limit: 10 });
  const ids = movers.map((m) => m.target);
  assert.deepEqual(ids, ["chaos", "divine", "vaal"]); // ghost, x, y all excluded
  assert.ok(!ids.includes("ghost") && !ids.includes("x") && !ids.includes("y"));
});

test("selectTopMovers never surfaces a stale row as a current top mover", () => {
  const data = {
    source: { sourceMode: "official" },
    rows: [
      { pairId: "exalted|stale", target: "stale", status: "ok", stale: true, movement: { h24: 0.9 } },
      { pairId: "exalted|fresh", target: "fresh", status: "ok", stale: false, movement: { h24: 0.04 } },
    ],
  };
  const { movers } = selectTopMovers(data, { limit: 5 });
  assert.deepEqual(movers.map((m) => m.target), ["fresh"]);
});

test("selectTopMovers defaults to 5 and degrades cleanly on empty/absent payloads", () => {
  assert.deepEqual(selectTopMovers(null), { movers: [], sample: false });
  assert.deepEqual(selectTopMovers({ rows: [] }), { movers: [], sample: false });
  const { sample } = selectTopMovers({ source: { sourceMode: "official" }, rows: [] });
  assert.equal(sample, false);
});
