import test from "node:test";
import assert from "node:assert/strict";
import { keyCurrencyCards, sparklinePoints } from "../apps/web/lib/key-currencies.js";

test("key currency cards quote chaos/divine in exalted and exalted in chaos", () => {
  const cards = keyCurrencyCards([
    { target: "chaos", anchor: "exalted", reference: 0.02, sparkline24h: [0.025, 0.02], movement: { h24: -0.2 } },
    { target: "divine", anchor: "exalted", reference: 100, sparkline24h: [90, 100], movement: { h24: 1 / 9 } },
  ]);
  assert.deepEqual(cards.map((card) => card.id), ["chaos", "divine", "exalted"]);
  assert.equal(cards[0].value, 0.02);
  assert.equal(cards[0].unit, "exalted");
  assert.equal(cards[1].value, 100);
  assert.equal(cards[2].value, 50);
  assert.equal(cards[2].unit, "chaos");
  assert.deepEqual(cards[2].values, [40, 50]);
  assert.equal(cards[2].movement, 0.25);
});

test("key currency cards and sparkline degrade cleanly when data is absent", () => {
  assert.ok(keyCurrencyCards([]).every((card) => card.available === false));
  assert.equal(sparklinePoints([]), "");
  assert.equal(sparklinePoints([1]), "");
  assert.match(sparklinePoints([1, 2, 1.5]), /^\d/);
});
