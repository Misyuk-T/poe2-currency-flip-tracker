import test from "node:test";
import assert from "node:assert/strict";

import { currentPriceGuidance, quoteFromAnchor } from "../apps/web/lib/price-guidance.js";

const HOUR = 3600_000;

function point(hour, reference, low, high) {
  return {
    completedHour: hour * HOUR,
    reference,
    low,
    high,
  };
}

test("currentPriceGuidance widens buy/sell targets as the horizon grows", () => {
  const series = [
    point(0, 100, 99, 101),
    point(1, 100, 98, 102),
    point(2, 100, 97, 103),
    point(3, 100, 96, 104),
    point(4, 100, 95, 105),
    point(5, 100, 94, 106),
    point(6, 100, 93, 107),
    point(7, 100, 92, 108),
  ];

  const short = currentPriceGuidance(series, 100, { horizonHours: 2, minSamples: 3 });
  const long = currentPriceGuidance(series, 100, { horizonHours: 6, minSamples: 3 });

  assert.equal(short.status, "ok");
  assert.equal(long.status, "ok");
  assert.ok(long.entry < short.entry, "longer horizon should allow a lower buy target");
  assert.ok(long.exit > short.exit, "longer horizon should allow a higher sell target");
});

test("quoteFromAnchor keeps sub-one prices in buy-to-sell order", () => {
  const rates = { exalted: 1, chaos: 0.02, divine: 100 };
  const buy = quoteFromAnchor(0.003156740351369062, { anchor: "exalted", rates });
  const sell = quoteFromAnchor(0.01530965180315902, { anchor: "exalted", rates });

  assert.deepEqual(buy, { value: 0.003156740351369062, unit: "exalted" });
  assert.deepEqual(sell, { value: 0.01530965180315902, unit: "exalted" });
  assert.ok(buy.value < sell.value, "displayed buy must remain below displayed sell");
});

test("quoteFromAnchor converts both sides into an explicitly selected currency", () => {
  const quote = quoteFromAnchor(0.01, {
    anchor: "exalted",
    displayCurrency: "chaos",
    rates: { exalted: 1, chaos: 0.02, divine: 100 },
  });

  assert.deepEqual(quote, { value: 0.5, unit: "chaos" });
});
