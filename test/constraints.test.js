import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizeConstraints, HORIZON_MAX } from "../src/server/constraints.js";

test("negative capital/gold/reserve are clamped to 0", () => {
  const { constraints, adjustments } = normalizeConstraints({
    currencyCapital: -100,
    goldAvailable: -5,
    goldReserve: -1000,
    horizonHours: 3,
  });
  assert.equal(constraints.currencyCapital, 0);
  assert.equal(constraints.goldAvailable, 0);
  assert.equal(constraints.goldReserve, 0);
  assert.ok(adjustments.length >= 3);
});

test("negative reserve cannot increase the spendable budget", () => {
  const { constraints } = normalizeConstraints({
    goldAvailable: 100000,
    goldReserve: -50000,
  });
  // budget = available - reserve; with reserve clamped to 0, budget == available.
  assert.equal(constraints.goldReserve, 0);
  const budget = constraints.goldAvailable - constraints.goldReserve;
  assert.equal(budget, 100000); // NOT 150000
});

test("reserve greater than available is clamped to available", () => {
  const { constraints, adjustments } = normalizeConstraints({
    goldAvailable: 40000,
    goldReserve: 999999,
  });
  assert.equal(constraints.goldReserve, 40000);
  assert.ok(adjustments.some((a) => a.includes("reserve clamped")));
});

test("horizon is clamped into the supported range and bad values default", () => {
  assert.equal(normalizeConstraints({ horizonHours: -3 }).constraints.horizonHours, 3);
  assert.equal(normalizeConstraints({ horizonHours: 0 }).constraints.horizonHours, 3);
  assert.equal(normalizeConstraints({ horizonHours: 999 }).constraints.horizonHours, HORIZON_MAX);
  assert.equal(normalizeConstraints({ horizonHours: Infinity }).constraints.horizonHours, HORIZON_MAX);
  assert.equal(normalizeConstraints({ horizonHours: "abc" }).constraints.horizonHours, 3);
});
