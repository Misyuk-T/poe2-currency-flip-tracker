import { test } from "node:test";
import assert from "node:assert/strict";

import { fetchBooks, computeOpportunities } from "../src/server/snapshot.js";
import { createFixtureProvider } from "../src/providers/fixture-provider.js";
import { createGoldRegistry } from "../src/domain/gold-costs.js";
import { POE2_GOLD_COSTS } from "../src/data/gold-costs-poe2.js";

const goldRegistry = createGoldRegistry(POE2_GOLD_COSTS, { game: "poe2" });
const HOUR = 3600_000;
const NOW = 10 * HOUR;

// The exact property names the frontend table sorts on. If a backend rename
// breaks this contract (e.g. the old Trend column referenced `spreadPct` which
// opportunities never exposed), this test fails instead of the UI silently
// no-op'ing the sort. (Fix 6)
const UI_SORT_KEYS = [
  "targetName",
  "grossSpreadPercent",
  "entryVWAP",
  "exitVWAP",
  "quantity",
  "grossProfit",
  "currencyROI",
  "totalGold",
  "profitPer100kGold",
  "limitingResource",
  "riskAdjustedScore",
];

async function opportunities(history = {}, horizonHours = 3) {
  const provider = createFixtureProvider({}, { freshenIndexed: false });
  const books = await fetchBooks(provider, { anchorId: "exalted", shortlist: ["divine", "chaos", "vaal"] });
  return computeOpportunities({
    books,
    goldRegistry,
    constraints: { currencyCapital: 1e9, goldAvailable: 1e9, goldReserve: 0, horizonHours },
    history,
    now: NOW,
    maxListingAgeMs: null,
  });
}

test("Fix 6: every opportunity exposes the properties the UI sorts on", async () => {
  const opps = await opportunities();
  for (const o of opps) {
    for (const key of UI_SORT_KEYS) {
      assert.ok(key in o, `opportunity is missing UI sort key "${key}" for ${o.targetCurrency}`);
    }
  }
});

test("Fix 7: opportunities are partitionable into actionable vs non-actionable", async () => {
  const opps = await opportunities();
  const vaal = opps.find((o) => o.targetCurrency === "vaal");
  assert.equal(vaal.rankable, false); // no gold cost
  assert.equal(vaal.actionable, false);
  assert.ok(typeof vaal.summary?.text === "string");
});

test("Fix 1: horizon flows through and the signal materially adjusts the score", async () => {
  // Rising spread history for divine over the last 3h.
  const divineHistory = [];
  for (let t = NOW - 3 * HOUR; t <= NOW; t += 20 * 60_000) {
    divineHistory.push({ t, target: "divine", spreadPct: ((t - (NOW - 3 * HOUR)) / HOUR) * 2 });
  }
  const opps = await opportunities({ divine: divineHistory }, 6);
  const divine = opps.find((o) => o.targetCurrency === "divine");
  assert.equal(divine.historySignal.horizonHours, 6); // requested horizon flows through
  assert.equal(divine.historySignal.status, "ok");
  // Score is the resource-adjusted metric re-weighted by the real signal, so it
  // is not identical to the raw profit-per-100k-gold.
  assert.notEqual(divine.riskAdjustedScore, divine.profitPer100kGold);
});
