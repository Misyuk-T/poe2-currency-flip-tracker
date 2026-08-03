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

test("mixed native anchors are converted before the Exalted card is inverted", () => {
  // Production shape: Chaos is quoted in Divine, while Divine is quoted in
  // Exalted. 1 / 0.125988 is Chaos per DIVINE (~7.94), not Chaos per Exalted.
  const cards = keyCurrencyCards([
    {
      target: "chaos",
      anchor: "divine",
      reference: 0.12598815766974242,
      sparkline24h: [0.12, 0.12598815766974242],
    },
    {
      target: "divine",
      anchor: "exalted",
      reference: 381.77873172820927,
      sparkline24h: [380, 381.77873172820927],
    },
  ]);

  const chaos = cards.find((card) => card.id === "chaos");
  const exalted = cards.find((card) => card.id === "exalted");
  const exaltedPerChaos = 0.12598815766974242 * 381.77873172820927;

  assert.equal(chaos.unit, "exalted");
  assert.ok(Math.abs(chaos.value - exaltedPerChaos) < 1e-12);
  assert.equal(exalted.unit, "chaos");
  assert.ok(Math.abs(exalted.value - 1 / exaltedPerChaos) < 1e-12);
  assert.ok(exalted.value < 1, "one Exalted must be a fraction of a Chaos at this rate");
  assert.notEqual(exalted.value, 1 / 0.12598815766974242, "must not invert the Divine-native row directly");
});

test("key currency cards and sparkline degrade cleanly when data is absent", () => {
  assert.ok(keyCurrencyCards([]).every((card) => card.available === false));
  assert.equal(sparklinePoints([]), "");
  assert.equal(sparklinePoints([1]), "");
  assert.match(sparklinePoints([1, 2, 1.5]), /^\d/);
});

test("PoE1 chaos anchor still produces all three key currency cards", () => {
  const cards = keyCurrencyCards([
    { target: "divine", anchor: "chaos", reference: 190, sparkline24h: [180, 190], movement: { h24: 1 / 18 } },
    { target: "exalted", anchor: "chaos", reference: 8, sparkline24h: [10, 8], movement: { h24: -0.2 } },
  ], "chaos");
  assert.equal(cards.find((card) => card.id === "chaos").unit, "exalted");
  assert.equal(cards.find((card) => card.id === "chaos").value, 1 / 8);
  assert.equal(cards.find((card) => card.id === "divine").value, 190);
  assert.equal(cards.find((card) => card.id === "exalted").value, 8);
});

test("display selection requotes native Alchemy cards instead of leaving Alchemy everywhere", () => {
  const rows = [
    { target: "chaos", anchor: "alchemy", reference: 2, sparkline24h: [1.5, 2] },
    { target: "divine", anchor: "alchemy", reference: 100, sparkline24h: [90, 100] },
    { target: "exalted", anchor: "alchemy", reference: 18, sparkline24h: [15, 18] },
  ];
  const cards = keyCurrencyCards(rows, "alchemy", "chaos");

  assert.equal(cards.find((card) => card.id === "chaos").unit, "alchemy");
  assert.equal(cards.find((card) => card.id === "divine").unit, "chaos");
  assert.equal(cards.find((card) => card.id === "divine").value, 50);
  assert.equal(cards.find((card) => card.id === "exalted").unit, "chaos");
  assert.equal(cards.find((card) => card.id === "exalted").value, 9);
});
