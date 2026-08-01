import test from "node:test";
import assert from "node:assert/strict";
import { unitRates } from "../apps/web/lib/market-units.js";

test("unitRates connects mixed native-anchor rows into one conversion graph", () => {
  const rates = unitRates([
    { target: "divine", anchor: "exalted", reference: 200 },
    { target: "chaos", anchor: "divine", reference: 0.25 },
  ], "exalted");
  assert.equal(rates.exalted, 1);
  assert.equal(rates.divine, 200);
  assert.equal(rates.chaos, 50);
});

test("unitRates leaves disconnected core units unavailable", () => {
  assert.deepEqual(unitRates([], "chaos"), { exalted: null, chaos: 1, divine: null });
});
