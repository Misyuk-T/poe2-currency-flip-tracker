import test from "node:test";
import assert from "node:assert/strict";

import { adaptiveMarketPrice, divineInExalted } from "../src/domain/market-price-display.js";

test("derives the Divine to Exalted rate for either anchor", () => {
  assert.equal(divineInExalted([{ target: "divine", reference: 240 }], "exalted"), 240);
  assert.equal(divineInExalted([{ target: "exalted", reference: 1 / 240 }], "divine"), 240);
  assert.equal(divineInExalted([], "exalted"), null);
});

test("uses Divine for prices at least one Divine and Exalted below it", () => {
  assert.deepEqual(adaptiveMarketPrice(480, { anchor: "exalted", divineInExalted: 240 }), { value: 2, unit: "divine" });
  assert.deepEqual(adaptiveMarketPrice(120, { anchor: "exalted", divineInExalted: 240 }), { value: 120, unit: "exalted" });
  assert.deepEqual(adaptiveMarketPrice(2, { anchor: "divine", divineInExalted: 240 }), { value: 2, unit: "divine" });
  assert.deepEqual(adaptiveMarketPrice(0.5, { anchor: "divine", divineInExalted: 240 }), { value: 120, unit: "exalted" });
});

test("keeps an honest fallback when the conversion rate is unavailable", () => {
  assert.deepEqual(adaptiveMarketPrice(12, { anchor: "exalted", divineInExalted: null }), { value: 12, unit: "exalted" });
  assert.deepEqual(adaptiveMarketPrice(null, { anchor: "exalted", divineInExalted: 240 }), { value: null, unit: null });
});
