import test from "node:test";
import assert from "node:assert/strict";

import { currentPriceGuidance, quoteFromAnchor, workingPrice } from "../apps/web/lib/price-guidance.js";

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
  // Long enough that BOTH horizons have several windows with their full future
  // present. Windows whose horizon runs past the end of the data are now
  // dropped, so an 8-point series could only ever offer two complete 6h windows
  // and the 6h case silently fell back to the non-horizon path.
  const series = Array.from({ length: 20 }, (_, hour) =>
    point(hour, 100, 99 - hour * 0.4, 101 + hour * 0.4),
  );

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

test("quoteFromAnchor falls back to the market anchor when exalted has no rate", () => {
  const buy = quoteFromAnchor(0.2, {
    anchor: "chaos",
    rates: { exalted: null, chaos: 1, divine: null },
  });
  const sell = quoteFromAnchor(0.25, {
    anchor: "chaos",
    rates: { exalted: null, chaos: 1, divine: null },
  });

  assert.deepEqual(buy, { value: 0.2, unit: "chaos" });
  assert.deepEqual(sell, { value: 0.25, unit: "chaos" });
});

test("workingPrice uses direct market rates when the anchor is not exalted", () => {
  const result = workingPrice(
    {
      anchor: "chaos",
      reference: 0.2222222222222222,
      displayPrice: { value: 0.2222222222222222, unit: "chaos" },
    },
    null,
    {
      rates: { exalted: null, chaos: 1, divine: null },
      preferredUnit: "chaos",
      now: 0,
    },
  );

  assert.equal(result.status, "ok");
  assert.equal(result.value, 0.2222222222222222);
  assert.equal(result.unit, "chaos");
  assert.equal(result.anchorValue, 0.2222222222222222);
});
