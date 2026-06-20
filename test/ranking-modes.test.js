import { test } from "node:test";
import assert from "node:assert/strict";

import { computeOpportunities, RANKING_MODES } from "../src/server/snapshot.js";
import { createGoldRegistry } from "../src/domain/gold-costs.js";

const reg = createGoldRegistry([
  { game: "poe2", itemId: "exalted", goldPerUnit: 120, effectiveFrom: "2026-06-19" },
  { game: "poe2", itemId: "divine", goldPerUnit: 800, effectiveFrom: "2026-06-19" },
  { game: "poe2", itemId: "chaos", goldPerUnit: 160, effectiveFrom: "2026-06-19" },
]);

const lvl = (side, price, available) => ({
  side,
  listingId: `${side}-${price}-${available}`,
  account: `acc-${price}`,
  indexed: "2026-06-19T11:59:00Z",
  price,
  bundleTarget: 1,
  availableTarget: available,
});

// divine: big absolute profit, modest ROI, low liquidity.
// chaos:  small absolute profit, high ROI, high liquidity.
const books = {
  anchorId: "exalted",
  byTarget: {
    divine: { entryLevels: [lvl("entry", 200, 100)], exitLevels: [lvl("exit", 210, 100)] },
    chaos: { entryLevels: [lvl("entry", 0.1, 5000)], exitLevels: [lvl("exit", 0.12, 5000)] },
  },
};

const constraints = { currencyCapital: 1e12, goldAvailable: 1e12, goldReserve: 0, goldMode: "strict" };
const NOW = Date.parse("2026-06-19T12:00:00Z");

function rankTop(mode) {
  const opps = computeOpportunities({ books, goldRegistry: reg, constraints, rankingMode: mode, now: NOW });
  return opps[0].targetCurrency;
}

test("RANKING_MODES is the exported allowlist", () => {
  assert.ok(RANKING_MODES.includes("roi"));
  assert.ok(RANKING_MODES.includes("liquidity"));
  assert.ok(RANKING_MODES.includes("risk"));
});

test("rank by profit puts the biggest absolute gross first (divine)", () => {
  assert.equal(rankTop("profit"), "divine");
});

test("rank by ROI puts the highest-return-per-capital first (chaos)", () => {
  assert.equal(rankTop("roi"), "chaos");
});

test("rank by liquidity puts the deepest book first (chaos)", () => {
  assert.equal(rankTop("liquidity"), "chaos");
});

test("unknown ranking mode falls back to default ordering", () => {
  const def = computeOpportunities({ books, goldRegistry: reg, constraints, rankingMode: "default", now: NOW });
  const bogus = computeOpportunities({ books, goldRegistry: reg, constraints, rankingMode: "nope", now: NOW });
  assert.deepEqual(
    bogus.map((o) => o.targetCurrency),
    def.map((o) => o.targetCurrency),
  );
});

test("risk mode sorts ascending by the risk heuristic (nulls last)", () => {
  const opps = computeOpportunities({ books, goldRegistry: reg, constraints, rankingMode: "risk", now: NOW });
  const scores = opps.map((o) => o.ranking.riskScore).filter((s) => s != null);
  const sorted = [...scores].sort((a, b) => a - b);
  assert.deepEqual(scores, sorted);
});
