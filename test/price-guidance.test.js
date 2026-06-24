import test from "node:test";
import assert from "node:assert/strict";

import { convertMarketPrice, currentPriceGuidance, workingPrice } from "../src/public/price-guidance.js";

test("converts user-observed prices between Exalted and Divine", () => {
  assert.equal(convertMarketPrice(2, "divine", "exalted", 240), 480);
  assert.equal(convertMarketPrice(120, "exalted", "divine", 240), 0.5);
  assert.equal(convertMarketPrice(240, "exalted", "exalted", 240), 240);
  assert.equal(convertMarketPrice(1, "divine", "exalted", null), null);
});

test("rebases historical relative ranges onto the user's current price", () => {
  const points = [
    { reference: 200, low: 196, high: 204 },
    { reference: 210, low: 205.8, high: 214.2 },
    { reference: 211, low: 206.78, high: 215.22 },
  ];
  const result = currentPriceGuidance(points, 240);
  assert.equal(result.status, "ok");
  assert.ok(Math.abs(result.entry - 235.2) < 1e-9);
  assert.ok(Math.abs(result.exit - 244.8) < 1e-9);
  // Recommendations follow 240, not the stale absolute 211 history.
  assert.ok(result.entry > 230);
});

test("guidance refuses invalid input and insufficient history", () => {
  assert.equal(currentPriceGuidance([], 240).status, "insufficient-history");
  assert.equal(currentPriceGuidance([], 0).status, "invalid-current-price");
});

test("working price uses manual current price before the delayed hourly midpoint", () => {
  const row = {
    anchor: "exalted",
    reference: 211,
    latestCompletedHour: 10_000,
    displayPrice: { value: 211, unit: "exalted" },
  };
  const result = workingPrice(row, { value: 240, unit: "exalted", updatedAt: 19_000 }, {
    divineInExalted: 240,
    now: 20_000,
  });
  assert.equal(result.source, "manual");
  assert.equal(result.value, 240);
  assert.equal(result.anchorValue, 240);
  assert.equal(result.ageMs, 1000);
});

test("working price falls back to hourly midpoint when no manual price exists", () => {
  const row = {
    anchor: "exalted",
    reference: 480,
    latestCompletedHour: 10_000,
    displayPrice: { value: 2, unit: "divine" },
  };
  const result = workingPrice(row, null, { divineInExalted: 240, now: 20_000 });
  assert.equal(result.source, "hourly");
  assert.equal(result.value, 2);
  assert.equal(result.unit, "divine");
  assert.equal(result.anchorValue, 480);
});

test("horizon guidance reports historical hit rate and time to hit", () => {
  const HOUR = 3600_000;
  const points = [
    { completedHour: 0, reference: 100, low: 98, high: 101 },
    { completedHour: HOUR, reference: 102, low: 100, high: 106 },
    { completedHour: 2 * HOUR, reference: 103, low: 101, high: 108 },
    { completedHour: 3 * HOUR, reference: 104, low: 100, high: 105 },
    { completedHour: 4 * HOUR, reference: 105, low: 103, high: 112 },
  ];
  const result = currentPriceGuidance(points, 200, { horizonHours: 2, minSamples: 3 });
  assert.equal(result.status, "ok");
  assert.equal(result.horizonSamples, 4);
  assert.ok(result.hitRate > 0 && result.hitRate <= 1);
  assert.ok(result.medianTimeToHitHours >= 1);
});
