import test from "node:test";
import assert from "node:assert/strict";

import {
  createTieredScheduler,
  estimateRequests,
  marketCandidates,
} from "../src/server/tiered-scheduler.js";
import { mergeBooks, pruneBooks } from "../src/server/snapshot.js";

test("C2: market candidates are category-allowlisted and deduplicated", () => {
  const catalog = { items: [
    { id: "chaos", category: "Currency" },
    { id: "chaos", category: "Currency" },
    { id: "fragment", category: "Fragments" },
    { id: "gem", category: "Uncut Gems" },
  ] };
  assert.deepEqual(marketCandidates(catalog, { categories: ["Currency", "Fragments"] }), ["chaos", "fragment"]);
  assert.deepEqual(marketCandidates(catalog, { categories: ["Currency"], exclude: ["chaos"] }), []);
});

test("C2: hot runs every tick while warm/cold are interval-gated and rotate", () => {
  const scheduler = createTieredScheduler({
    hotTargets: ["hot"],
    candidates: ["hot", "w1", "w2", "w3", "c1", "c2", "c3", "c4", "c5", "c6"],
    warmSize: 1,
    coldSize: 2,
    warmEveryMs: 100,
    coldEveryMs: 1000,
  });
  const first = scheduler.next({ at: 1 });
  assert.deepEqual(first.tiers, ["hot", "warm", "cold"]);
  assert.equal(first.targets.length, 4);
  scheduler.commit(first);

  const hotOnly = scheduler.next({ at: 50 });
  assert.deepEqual(hotOnly, { targets: ["hot"], tiers: ["hot"], plannedAt: 50 });

  const warmAgain = scheduler.next({ at: 101 });
  assert.deepEqual(warmAgain.tiers, ["hot", "warm"]);
  assert.notEqual(warmAgain.targets[1], first.targets[1], "warm slice should rotate");
});

test("C2: a failed/uncommitted plan is retried instead of losing its slice", () => {
  const scheduler = createTieredScheduler({ hotTargets: ["hot"], candidates: ["hot", "w1", "w2", "c1"] });
  const attempted = scheduler.next({ at: 1 });
  const retry = scheduler.next({ at: 2 });
  assert.deepEqual(retry.targets, attempted.targets);
});

test("C2: request estimate includes batched entry and per-target exit legs", () => {
  assert.equal(estimateRequests(8, 2, 4), 20);
  assert.equal(estimateRequests(0, 2, 4), 0);
});

test("C2: incremental book merge preserves cold targets and updates fetched targets", () => {
  const previous = {
    anchorId: "exalted",
    fetchedAt: 100,
    byTarget: { chaos: { fetchedAt: 100 }, divine: { fetchedAt: 90 } },
  };
  const incremental = {
    anchorId: "exalted",
    fetchedAt: 200,
    byTarget: { chaos: { fetchedAt: 200 } },
  };
  assert.deepEqual(mergeBooks(previous, incremental), {
    anchorId: "exalted",
    fetchedAt: 200,
    byTarget: { chaos: { fetchedAt: 200 }, divine: { fetchedAt: 90 } },
  });
});

test("C2: tracked books are capped while hot targets are never evicted", () => {
  const books = {
    anchorId: "exalted",
    fetchedAt: 100,
    byTarget: {
      hot: { fetchedAt: 1 },
      old: { fetchedAt: 2 },
      warm: { fetchedAt: 3 },
      newest: { fetchedAt: 4 },
    },
  };
  const pruned = pruneBooks(books, { maxTargets: 3, preserve: ["hot"] });
  assert.deepEqual(Object.keys(pruned.byTarget).sort(), ["hot", "newest", "warm"]);
});
