import { test } from "node:test";
import assert from "node:assert/strict";

import { buildOpportunity } from "../src/domain/opportunities.js";
import { buildBook } from "../src/domain/order-book.js";
import { executableQuote } from "../src/domain/executable-quote.js";
import { createGoldRegistry } from "../src/domain/gold-costs.js";

const reg = createGoldRegistry([
  { game: "poe2", itemId: "exalted", goldPerUnit: 120, effectiveFrom: "2026-06-19" },
  { game: "poe2", itemId: "divine", goldPerUnit: 800, effectiveFrom: "2026-06-19" },
]);

function lvl(side, price, bundleTarget, availableTarget) {
  return {
    side,
    listingId: `${side}-${price}-${bundleTarget}`,
    account: `acc-${price}`,
    indexed: "2026-06-19T12:00:00Z",
    price,
    bundleTarget,
    availableTarget,
  };
}

test("Fix 9: incompatible bundle sizes -> recommend only a fully-executable quantity", () => {
  // Entry: buy divine in singles, up to 10 available.
  // Exit:  the only exit book sells divine in bundles of 7, depth 14.
  const entryLevels = [lvl("entry", 100, 1, 10)];
  const exitLevels = [lvl("exit", 110, 7, 14)];

  // Sanity: naive depth cap (10) is NOT fully sellable on exit (7 fill, 3 left).
  const naive = executableQuote(buildBook(exitLevels), 10, { now: Date.parse("2026-06-19T12:00:00Z") });
  assert.ok(naive.unfilledTarget > 0);

  const o = buildOpportunity({
    anchorId: "exalted",
    targetId: "divine",
    entryLevels,
    exitLevels,
    goldRegistry: reg,
    constraints: { currencyCapital: 1e12, goldAvailable: 1e12, goldReserve: 0 },
    now: Date.parse("2026-06-19T12:00:00Z"),
    maxListingAgeMs: null,
  });

  // The engine drops to 7 (a quantity BOTH legs fully execute), never 10.
  assert.equal(o.quantity, 7);
  assert.equal(o.sizing.maxFullyExecutable, 7);
  assert.ok(!o.warnings.includes("partial-exit"));
  assert.equal(o.limitingResource, "liquidity-exit");
  assert.equal(o.grossProfit, 7 * (110 - 100));
});

test("Fix 9: exit book that cannot sell ANY reachable size is non-actionable", () => {
  // Entry buys 5 singles; exit only sells in bundles of 9 -> nothing executable.
  const o = buildOpportunity({
    anchorId: "exalted",
    targetId: "divine",
    entryLevels: [lvl("entry", 100, 1, 5)],
    exitLevels: [lvl("exit", 110, 9, 9)],
    goldRegistry: reg,
    constraints: { currencyCapital: 1e12, goldAvailable: 1e12, goldReserve: 0 },
    now: Date.parse("2026-06-19T12:00:00Z"),
    maxListingAgeMs: null,
  });
  assert.equal(o.quantity, 0);
  assert.equal(o.actionable, false);
  assert.ok(o.warnings.includes("exit-not-executable"));
  assert.equal(o.limitingResource, "bundle-mismatch");
});

test("Fix 9: a position cap that truncates below the first executable size is labelled 'position', not bundle-mismatch", () => {
  // Entry bundles of 2, exit bundles of 3 -> first common executable size is 6.
  // A maxPosition of 5 truncates the reachable set to {2,4}, none executable.
  const o = buildOpportunity({
    anchorId: "exalted",
    targetId: "divine",
    entryLevels: [lvl("entry", 100, 2, 12)],
    exitLevels: [lvl("exit", 110, 3, 12)],
    goldRegistry: reg,
    constraints: { currencyCapital: 1e12, goldAvailable: 1e12, goldReserve: 0, maxPositionTarget: 5 },
    now: Date.parse("2026-06-19T12:00:00Z"),
    maxListingAgeMs: null,
  });
  assert.equal(o.quantity, 0);
  assert.equal(o.limitingResource, "position"); // not "bundle-mismatch": a higher cap would execute (6)
});
