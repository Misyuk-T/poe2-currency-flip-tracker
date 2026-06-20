import { test } from "node:test";
import assert from "node:assert/strict";

import { createGoldRegistry, goldForLeg, roundTripGold } from "../src/domain/gold-costs.js";
import { POE2_GOLD_COSTS } from "../src/data/gold-costs-poe2.js";

test("case 7: gold is integer and conservatively rounded up", () => {
  assert.equal(goldForLeg(5, 800), 4000);
  assert.equal(goldForLeg(1050, 120), 126000);
  assert.equal(goldForLeg(1.001, 100), 101); // rounds up
  assert.equal(goldForLeg(2.5, 161), Math.ceil(2.5 * 161));
  assert.equal(goldForLeg(0, 800), 0);
  assert.equal(goldForLeg(10, undefined), null); // unknown cost
});

test("case 8: asymmetric entry vs exit gold", () => {
  const g = roundTripGold({
    receivedTarget: 5,
    receivedAnchorOnExit: 1050,
    goldPerTarget: 800,
    goldPerAnchor: 120,
  });
  assert.equal(g.entryGold, 4000);
  assert.equal(g.exitGold, 126000);
  assert.notEqual(g.entryGold, g.exitGold);
});

test("case 11: 1000 Ex -> 5 Divine -> 1050 Ex costs 130,000 gold", () => {
  const reg = createGoldRegistry(POE2_GOLD_COSTS, { game: "poe2" });
  const g = roundTripGold({
    receivedTarget: 5, // divine received on entry
    receivedAnchorOnExit: 1050, // exalted received on exit
    goldPerTarget: reg.goldPerUnit("divine"),
    goldPerAnchor: reg.goldPerUnit("exalted"),
  });
  assert.equal(g.entryGold, 5 * 800);
  assert.equal(g.exitGold, 1050 * 120);
  assert.equal(g.totalGold, 130000);
});

test("registry refuses to mix games and keeps newest record", () => {
  assert.throws(() =>
    createGoldRegistry([
      { game: "poe2", itemId: "x", goldPerUnit: 1, effectiveFrom: "2026-01-01" },
      { game: "poe1", itemId: "y", goldPerUnit: 2, effectiveFrom: "2026-01-01" },
    ], { game: "poe2" }),
  );
  const reg = createGoldRegistry([
    { game: "poe2", itemId: "x", goldPerUnit: 1, effectiveFrom: "2025-01-01" },
    { game: "poe2", itemId: "x", goldPerUnit: 9, effectiveFrom: "2026-01-01" },
  ]);
  assert.equal(reg.goldPerUnit("x"), 9);
});

test("unknown gold cost yields null totals, never a fabricated value", () => {
  const g = roundTripGold({
    receivedTarget: 5,
    receivedAnchorOnExit: 1050,
    goldPerTarget: undefined, // e.g. vaal
    goldPerAnchor: 120,
  });
  assert.equal(g.entryGold, null);
  assert.equal(g.totalGold, null);
});
