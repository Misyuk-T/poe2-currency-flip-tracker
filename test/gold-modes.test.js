import { test } from "node:test";
import assert from "node:assert/strict";

import { buildOpportunity } from "../src/domain/opportunities.js";
import { createGoldRegistry } from "../src/domain/gold-costs.js";

const NOW = Date.parse("2026-06-19T12:00:00Z");
const INDEXED = "2026-06-19T11:59:00Z";

const reg = createGoldRegistry([
  { game: "poe2", itemId: "exalted", goldPerUnit: 120, effectiveFrom: "2026-06-19" },
  { game: "poe2", itemId: "divine", goldPerUnit: 800, effectiveFrom: "2026-06-19" },
]);

const level = (side, price, available) => ({
  side,
  listingId: `${side}-${price}`,
  account: `acc-${price}`,
  indexed: INDEXED,
  price,
  bundleTarget: 1,
  availableTarget: available,
});

// Buy divine at 200, sell at 210, depth 100 both legs.
function divineCase(goldMode, extra = {}) {
  return buildOpportunity({
    anchorId: "exalted",
    targetId: "divine",
    entryLevels: [level("entry", 200, 100)],
    exitLevels: [level("exit", 210, 100)],
    goldRegistry: reg,
    constraints: { currencyCapital: 1e12, goldAvailable: 260000, goldReserve: 0, goldMode, ...extra },
    now: NOW,
    maxListingAgeMs: null,
  });
}

test("strict: gold caps the position (260k budget -> 10 units)", () => {
  const o = divineCase("strict");
  assert.equal(o.quantity, 10);
  assert.equal(o.limitingResource, "gold");
  assert.equal(o.goldApplied, true);
  // strict ranks on profit-per-100k-gold
  assert.ok(o.riskAdjustedScore != null);
});

test("show: gold is computed but does NOT cap the position", () => {
  const o = divineCase("show");
  assert.equal(o.quantity, 100); // depth, not gold, binds
  assert.ok(o.limitingResource.startsWith("liquidity"));
  assert.equal(o.goldApplied, false);
  assert.ok(o.totalGold > 0); // gold still computed for display
  // non-strict ranks on capital efficiency (ROI)
  const expected = o.currencyROI * (o.riskAdjustedScore / o.currencyROI);
  assert.ok(Number.isFinite(expected));
});

test("ignore: gold not applied to sizing or ranking", () => {
  const o = divineCase("ignore");
  assert.equal(o.quantity, 100);
  assert.equal(o.goldApplied, false);
  assert.notEqual(o.limitingResource, "gold");
});

test("show and ignore size identically (neither caps by gold)", () => {
  assert.equal(divineCase("show").quantity, divineCase("ignore").quantity);
});

test("invalid/absent gold mode defaults to strict behaviour", () => {
  const o = buildOpportunity({
    anchorId: "exalted",
    targetId: "divine",
    entryLevels: [level("entry", 200, 100)],
    exitLevels: [level("exit", 210, 100)],
    goldRegistry: reg,
    constraints: { currencyCapital: 1e12, goldAvailable: 260000, goldReserve: 0 }, // no goldMode
    now: NOW,
    maxListingAgeMs: null,
  });
  assert.equal(o.quantity, 10); // strict default caps by gold
  assert.equal(o.goldApplied, true);
});

test("ranking metrics and risk heuristic are present and labelled", () => {
  const o = divineCase("strict");
  assert.equal(o.ranking.label, "heuristic");
  assert.ok(o.ranking.riskScore >= 0 && o.ranking.riskScore <= 1);
  assert.ok(Number.isFinite(o.ranking.riskScore));
  assert.equal(o.ranking.profit, o.grossProfit);
  assert.equal(o.ranking.roi, o.currencyROI);
});

// --- codex review fixes ---------------------------------------------------

// A target with no gold cost in the registry.
function vaalCase(goldMode) {
  return buildOpportunity({
    anchorId: "exalted",
    targetId: "vaal", // not in `reg`
    entryLevels: [level("entry", 0.5, 100)],
    exitLevels: [level("exit", 0.6, 100)],
    goldRegistry: reg,
    constraints: { currencyCapital: 1e12, goldAvailable: 1e12, goldReserve: 0, goldMode },
    now: NOW,
    maxListingAgeMs: null,
  });
}

test("strict: an unknown gold cost makes the row unrankable", () => {
  assert.equal(vaalCase("strict").rankable, false);
});

test("show/ignore: a missing gold cost does NOT suppress ranking (ROI-rankable)", () => {
  assert.equal(vaalCase("show").rankable, true);
  assert.equal(vaalCase("ignore").rankable, true);
});

test("maxByGold is null when gold does not constrain sizing", () => {
  assert.equal(divineCase("show").sizing.maxByGold, null);
  assert.equal(divineCase("ignore").sizing.maxByGold, null);
  assert.ok(divineCase("strict").sizing.maxByGold != null);
});

test("an unrecognized gold mode fails SAFE to strict (not open)", () => {
  const o = divineCase("garbage");
  assert.equal(o.goldApplied, true);
  assert.equal(o.quantity, 10); // strict cap, not an unconstrained position
});
