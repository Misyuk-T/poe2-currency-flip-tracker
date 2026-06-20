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

function level(side, price, available) {
  return {
    side,
    listingId: `${side}-${price}`,
    account: `acc-${price}`,
    indexed: INDEXED,
    price,
    bundleTarget: 1,
    availableTarget: available,
  };
}

// Buy divine at 200, sell at 210, depth 100 on both legs.
function divineCase(constraints, targetId = "divine") {
  return buildOpportunity({
    anchorId: "exalted",
    targetId,
    entryLevels: [level("entry", 200, 100)],
    exitLevels: [level("exit", 210, 100)],
    goldRegistry: reg,
    constraints,
    now: NOW,
    maxListingAgeMs: null,
  });
}

// Real, well-covered rising-spread history so an opportunity can be actionable
// (history gating is a separate Codex fix; here we just need a valid signal).
function risingHistory(target, now, horizonHours = 3, stepMin = 20) {
  const pts = [];
  const span = horizonHours * 3600_000;
  for (let t = now - span; t <= now; t += stepMin * 60_000) {
    pts.push({ t, target, spreadPct: ((t - (now - span)) / 3600_000) * 1 });
  }
  return pts;
}

// Regression (Codex #1) at the opportunity level: a cheap entry level whose
// bundle (5) is LARGER than the requested cap (3) must NOT make the round trip
// non-actionable — greedy sweep skips it and fills 3 from the later bundle-of-1
// level. Before the fix, reachableQuantities returned [] and the opportunity was
// falsely classified bundle-mismatch / non-actionable.
test("Codex #1: oversized cheap entry bundle does not falsely zero the position", () => {
  const o = buildOpportunity({
    anchorId: "exalted",
    targetId: "divine",
    // cheap bundleTarget=5 available=100, then worse bundleTarget=1 available=10
    entryLevels: [
      { side: "entry", listingId: "e5", account: "cheap", indexed: INDEXED, price: 210, bundleTarget: 5, availableTarget: 100 },
      { side: "entry", listingId: "e1", account: "worse", indexed: INDEXED, price: 220, bundleTarget: 1, availableTarget: 10 },
    ],
    exitLevels: [level("exit", 240, 100)], // bundle 1, sells anything
    goldRegistry: reg,
    constraints: { currencyCapital: 1e12, goldAvailable: 1e12, goldReserve: 0, maxPositionTarget: 3 },
    history: risingHistory("divine", NOW),
    now: NOW,
    maxListingAgeMs: null,
  });

  assert.equal(o.quantity, 3); // filled from the bundle-of-1 level
  assert.notEqual(o.limitingResource, "bundle-mismatch");
  assert.notEqual(o.limitingResource, "exit-not-executable");
  assert.equal(o.sizing.maxFullyExecutable, 3);
  assert.ok(o.grossProfit > 0);
  assert.equal(o.actionable, true); // real history + profit -> actionable
});

// --- Codex #2: history/freshness gating of actionable ----------------------

test("Codex #2: fresh install with insufficient history is NOT actionable and does not say Buy", () => {
  // Positive current spread (200 -> 210) but NO real history at all.
  const o = divineCase({ currencyCapital: 1e12, goldAvailable: 1e12, goldReserve: 0 });
  assert.equal(o.historySignal.status, "insufficient-history");
  assert.ok(o.grossProfit > 0); // the current spread is positive...
  assert.equal(o.actionable, false); // ...yet it is NOT a recommendation
  // Metrics stay visible, but the summary must not INSTRUCT a Buy.
  assert.doesNotMatch(o.summary.text, /^Buy /);
  assert.match(o.summary.text, /not a buy recommendation/i);
  assert.equal(o.summary.grossProfit, o.grossProfit); // metrics retained
});

test("Codex #2: a valid, well-covered history signal makes the positive spread actionable", () => {
  const o = buildOpportunity({
    anchorId: "exalted",
    targetId: "divine",
    entryLevels: [level("entry", 200, 100)],
    exitLevels: [level("exit", 210, 100)],
    goldRegistry: reg,
    constraints: { currencyCapital: 1e12, goldAvailable: 1e12, goldReserve: 0, horizonHours: 3 },
    history: risingHistory("divine", NOW, 3),
    now: NOW,
    maxListingAgeMs: null,
  });
  assert.equal(o.historySignal.status, "ok");
  assert.equal(o.actionable, true);
  assert.match(o.summary.text, /^Buy /);
});

test("Codex #2: stale data is never actionable even with a valid history signal", () => {
  const o = buildOpportunity({
    anchorId: "exalted",
    targetId: "divine",
    entryLevels: [level("entry", 200, 100)],
    exitLevels: [level("exit", 210, 100)],
    goldRegistry: reg,
    constraints: { currencyCapital: 1e12, goldAvailable: 1e12, goldReserve: 0, horizonHours: 3 },
    history: risingHistory("divine", NOW, 3),
    now: NOW,
    maxListingAgeMs: 30 * 1000, // listing is 60s old -> stale
  });
  assert.equal(o.historySignal.status, "ok");
  assert.ok(o.freshness.stale);
  assert.equal(o.actionable, false);
  assert.doesNotMatch(o.summary.text, /^Buy /);
  assert.match(o.summary.text, /stale/i);
});

// --- Codex #3: expectedProfit must not masquerade as a forecast -------------

test("Codex #3: expectedProfit is null (no forecast model); current-book gross is named explicitly", () => {
  const o = divineCase({ currencyCapital: 1000, goldAvailable: 1e12, goldReserve: 0 });
  assert.equal(o.expectedProfit, null);
  assert.equal(o.currentBookGrossProfit, o.grossProfit);
  assert.ok(o.grossProfit > 0);
});

test("case 10a: capital-constrained position sizing", () => {
  const o = divineCase({ currencyCapital: 1000, goldAvailable: 1e12, goldReserve: 0 });
  // 200 ex/divine -> 1000 ex buys 5 divine
  assert.equal(o.quantity, 5);
  assert.equal(o.limitingResource, "capital");
  assert.equal(o.grossProfit, 5 * (210 - 200));
  assert.equal(o.currencyROI, 50 / 1000);
});

test("case 9: gold-constrained position sizing", () => {
  // cycleGold(q) = 800q + 120*(210q) = 26000q ; budget 260000 -> q<=10
  const o = divineCase({ currencyCapital: 1e12, goldAvailable: 260000, goldReserve: 0 });
  assert.equal(o.quantity, 10);
  assert.equal(o.limitingResource, "gold");
  assert.equal(o.totalGold, 260000);
  assert.equal(o.entryGold, 10 * 800);
  assert.equal(o.exitGold, 210 * 10 * 120);
});

test("case 10b: liquidity-constrained position sizing", () => {
  const o = divineCase({ currencyCapital: 1e12, goldAvailable: 1e12, goldReserve: 0 });
  assert.equal(o.quantity, 100); // capped by depth
  assert.ok(o.limitingResource.startsWith("liquidity"));
  assert.equal(o.grossProfit, 100 * 10);
});

test("hard eligibility: gold reserve can zero out the position", () => {
  const o = divineCase({ currencyCapital: 1e12, goldAvailable: 100000, goldReserve: 100000 });
  assert.equal(o.quantity, 0);
  assert.equal(o.limitingResource, "gold");
  assert.ok(o.warnings.includes("no-feasible-position"));
});

test("case 12 (domain): unknown gold cost is surfaced, not invented", () => {
  const o = divineCase({ currencyCapital: 1000, goldAvailable: 1e12, goldReserve: 0 }, "vaal");
  assert.equal(o.totalGold, null);
  assert.equal(o.profitPer100kGold, null);
  assert.equal(o.sizing.maxByGold, null);
  assert.ok(o.warnings.includes("unknown-gold-cost"));
  // capital still binds sizing even without gold data
  assert.equal(o.quantity, 5);
});

test("profit per 100k gold and headline spread are computed", () => {
  const o = divineCase({ currencyCapital: 1e12, goldAvailable: 1e12, goldReserve: 0 });
  const expected = (o.grossProfit / o.totalGold) * 100000;
  assert.ok(Math.abs(o.profitPer100kGold - expected) < 1e-9);
  assert.ok(Math.abs(o.grossSpreadPercent - ((210 - 200) / 200) * 100) < 1e-9);
  assert.deepEqual(o.fillProbability, { h1: null, h3: null, h6: null });
});

test("negative round trip is flagged, not hidden", () => {
  const o = buildOpportunity({
    anchorId: "exalted",
    targetId: "divine",
    entryLevels: [level("entry", 210, 100)], // buy high
    exitLevels: [level("exit", 200, 100)], // sell low
    goldRegistry: reg,
    constraints: { currencyCapital: 1e12, goldAvailable: 1e12, goldReserve: 0 },
    now: NOW,
    maxListingAgeMs: null,
  });
  assert.ok(o.grossProfit < 0);
  assert.ok(o.warnings.includes("negative-profit"));
});

test("stale listings are flagged via maxListingAge", () => {
  const o = buildOpportunity({
    anchorId: "exalted",
    targetId: "divine",
    entryLevels: [level("entry", 200, 100)],
    exitLevels: [level("exit", 210, 100)],
    goldRegistry: reg,
    constraints: { currencyCapital: 1000, goldAvailable: 1e12, goldReserve: 0 },
    now: NOW,
    maxListingAgeMs: 30 * 1000, // 30s; listing is 60s old
  });
  assert.ok(o.freshness.stale);
  assert.ok(o.warnings.includes("stale-data"));
});
