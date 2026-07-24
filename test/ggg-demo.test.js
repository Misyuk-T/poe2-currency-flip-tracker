import test from "node:test";
import assert from "node:assert/strict";

import { mockLeagueMeta, mockLadderSnapshot, mockCharacterInventory, valueInventoryInExalted } from "../apps/web/lib/ggg-demo.js";

test("mockLeagueMeta is deterministic per league and internally consistent", () => {
  const now = Date.parse("2026-07-25T00:00:00Z");
  const a = mockLeagueMeta("Runes of Aldur", { now });
  const b = mockLeagueMeta("Runes of Aldur", { now });
  assert.deepEqual(a, b);
  assert.ok(a.dayNumber >= 1 && a.dayNumber < 91);
  assert.ok(a.daysRemaining >= 1 && a.daysRemaining <= 91);
  assert.equal(a.startAt + 91 * 86_400_000, a.endAt);
  assert.equal(now - a.startAt, a.dayNumber * 86_400_000);
});

test("mockLeagueMeta gives different leagues different day numbers", () => {
  const now = Date.parse("2026-07-25T00:00:00Z");
  const a = mockLeagueMeta("Runes of Aldur", { now });
  const b = mockLeagueMeta("Standard", { now });
  assert.notEqual(a.dayNumber, b.dayNumber);
});

test("mockLadderSnapshot median level grows with day number and saturates at 100", () => {
  const early = mockLadderSnapshot("X", { dayNumber: 2 });
  const mid = mockLadderSnapshot("X", { dayNumber: 20 });
  const late = mockLadderSnapshot("X", { dayNumber: 80 });
  assert.ok(early.medianLevel < mid.medianLevel);
  assert.equal(late.medianLevel, 100);
  assert.ok(late.levelsPerDay === 0);
});

test("mockLadderSnapshot distribution counts sum to totalEntries", () => {
  const snapshot = mockLadderSnapshot("X", { dayNumber: 14 });
  const sum = snapshot.distribution.reduce((total, bucket) => total + bucket.count, 0);
  assert.ok(Math.abs(sum - snapshot.totalEntries) <= snapshot.distribution.length);
});

test("mockCharacterInventory returns priceable core currency ids", () => {
  const character = mockCharacterInventory("Runes of Aldur");
  const ids = character.currency.map((item) => item.id);
  assert.deepEqual(ids, ["exalted", "chaos", "divine"]);
  assert.ok(character.currency.every((item) => item.stackSize > 0));
});

test("valueInventoryInExalted prices known rates and nulls out unknown ones", () => {
  const items = [
    { id: "exalted", stackSize: 100 },
    { id: "chaos", stackSize: 50 },
    { id: "mystery", stackSize: 10 },
  ];
  const rates = { exalted: 1, chaos: 0.1, divine: 180 };
  const { items: priced, totalExalted } = valueInventoryInExalted(items, rates);
  assert.equal(priced[0].exaltedValue, 100);
  assert.equal(priced[1].exaltedValue, 5);
  assert.equal(priced[2].exaltedValue, null);
  assert.equal(totalExalted, 105);
});

test("valueInventoryInExalted returns null total when nothing is priceable", () => {
  const { totalExalted } = valueInventoryInExalted([{ id: "mystery", stackSize: 10 }], { exalted: 1 });
  assert.equal(totalExalted, null);
});
