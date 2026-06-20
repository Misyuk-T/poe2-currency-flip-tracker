import { test } from "node:test";
import assert from "node:assert/strict";

import { computeOpportunities } from "../src/server/snapshot.js";
import { createGoldRegistry } from "../src/domain/gold-costs.js";

const HOUR = 3600_000;
const NOW = 10 * HOUR;

// Two targets with IDENTICAL economics (same books, same gold cost) so the only
// thing that can change their ranking is the horizon-derived history signal.
const reg = createGoldRegistry([
  { game: "poe2", itemId: "exalted", goldPerUnit: 120, effectiveFrom: "2026-06-19" },
  { game: "poe2", itemId: "aaa", goldPerUnit: 800, effectiveFrom: "2026-06-19" },
  { game: "poe2", itemId: "bbb", goldPerUnit: 800, effectiveFrom: "2026-06-19" },
]);

function legs() {
  return {
    entryLevels: [
      { side: "entry", listingId: "e", account: "e", indexed: "2026-06-19T12:00:00Z", price: 200, bundleTarget: 1, availableTarget: 100 },
    ],
    exitLevels: [
      { side: "exit", listingId: "x", account: "x", indexed: "2026-06-19T12:00:00Z", price: 210, bundleTarget: 1, availableTarget: 100 },
    ],
  };
}

const books = { anchorId: "exalted", byTarget: { aaa: legs(), bbb: legs() } };

// aaa: flat for the older 5h, rises only in the last hour -> strong 1h momentum, weak 6h.
// bbb: rises for the older 5h, flat in the last hour -> weak 1h momentum, strong 6h.
function history() {
  const aaa = [];
  const bbb = [];
  for (let ha = 6; ha >= 0; ha -= 0.25) {
    const t = NOW - ha * HOUR;
    aaa.push({ t, target: "aaa", spreadPct: ha > 1 ? 5 : 5 + (1 - ha) * 1 });
    bbb.push({ t, target: "bbb", spreadPct: ha > 1 ? 5 + (6 - ha) * 0.5 : 7.5 });
  }
  return { aaa, bbb };
}

function order(horizonHours) {
  const opps = computeOpportunities({
    books,
    goldRegistry: reg,
    constraints: { currencyCapital: 1e9, goldAvailable: 1e9, goldReserve: 0, horizonHours },
    history: history(),
    now: NOW,
    maxListingAgeMs: null,
  });
  return opps.map((o) => o.targetCurrency);
}

test("Fix 1: horizon materially changes the ranking order (not just one score)", () => {
  const at1h = order(1);
  const at6h = order(6);
  // Same two opportunities, identical economics — only the horizon differs.
  assert.deepEqual([...at1h].sort(), ["aaa", "bbb"]);
  assert.notDeepEqual(at1h, at6h); // the order actually swaps with the horizon
  assert.equal(at1h[0], "aaa"); // recent momentum wins at 1h
  assert.equal(at6h[0], "bbb"); // sustained momentum wins at 6h
});
