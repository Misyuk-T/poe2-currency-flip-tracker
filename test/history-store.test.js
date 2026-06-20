import { test } from "node:test";
import assert from "node:assert/strict";

import { createHistoryStore, pointFromBooks } from "../src/server/history-store.js";
import { buildBook, bookDepth } from "../src/domain/order-book.js";
import { seedFixtureHistory } from "../src/data/fixtures/exchange-fixtures.js";

test("history store keeps points chronological and ring-bounded (in-memory)", () => {
  const store = createHistoryStore({ filePath: null, maxPointsPerTarget: 3 });
  store.seed([
    { t: 30, target: "divine", spreadPct: 3 },
    { t: 10, target: "divine", spreadPct: 1 },
    { t: 20, target: "divine", spreadPct: 2 },
  ]);
  const pts = store.get("divine");
  assert.deepEqual(pts.map((p) => p.t), [10, 20, 30]); // sorted
  store.seed([{ t: 40, target: "divine", spreadPct: 4 }]);
  assert.equal(store.get("divine").length, 3); // bounded
  assert.equal(store.get("divine")[0].t, 20); // oldest dropped
});

test("pointFromBooks derives best prices, spread and depth", () => {
  const entryBook = buildBook([
    { side: "entry", listingId: "a", price: 200, bundleTarget: 1, availableTarget: 10 },
    { side: "entry", listingId: "b", price: 205, bundleTarget: 1, availableTarget: 10 },
  ]);
  const exitBook = buildBook([
    { side: "exit", listingId: "c", price: 215, bundleTarget: 1, availableTarget: 5 },
  ]);
  const p = pointFromBooks({ target: "divine", t: 123, entryBook, exitBook, bookDepth });
  assert.equal(p.bestEntry, 200);
  assert.equal(p.bestExit, 215);
  assert.equal(p.depthEntry, 20);
  assert.equal(p.depthExit, 5);
  assert.ok(Math.abs(p.spreadPct - ((215 - 200) / 200) * 100) < 1e-9);
});

test("synthetic fixture history is generated for known targets and flagged", () => {
  const points = seedFixtureHistory({ shortlist: ["divine", "vaal", "unknown"], now: 10_000_000 });
  const divine = points.filter((p) => p.target === "divine");
  assert.ok(divine.length >= 12);
  assert.ok(divine.every((p) => p.synthetic === true));
  assert.equal(points.filter((p) => p.target === "unknown").length, 0); // no nominal -> skipped
});
