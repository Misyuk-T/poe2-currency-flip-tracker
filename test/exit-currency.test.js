import test from "node:test";
import assert from "node:assert/strict";

import { bestExitCurrency } from "../apps/web/lib/exit-currency.js";

// Realistic PoE2 shape: exalted is the cheap base unit, chaos/divine are worth more.
const RATES = { exalted: 1, chaos: 51.5, divine: 435 };
const GOLD = { exalted: 120, chaos: 160, divine: 800 };
const ctx = { rates: RATES, goldPerUnit: GOLD };

test("a cheap holding can only be taken in exalted — chaos/divine would be a fraction of an orb", () => {
  const { best, candidates } = bestExitCurrency(5, ctx);
  assert.equal(best.unit, "exalted");
  assert.equal(candidates.find((c) => c.unit === "chaos").fillable, false);
  assert.equal(candidates.find((c) => c.unit === "divine").fillable, false);
});

test("a mid holding prefers chaos: fewer units received than exalted, so less gold", () => {
  const { best } = bestExitCurrency(69, ctx);
  assert.equal(best.unit, "chaos");
  // 69/51.5 = 1.34 chaos -> ceil(1.34 * 160) = 215 gold, vs 69 * 120 = 8280 as exalted.
  assert.equal(best.gold, 215);
});

test("a large holding prefers divine — the highest-value unit that still fills", () => {
  const { best } = bestExitCurrency(6090, ctx);
  assert.equal(best.unit, "divine");
  assert.equal(best.units, 14);
  assert.equal(best.gold, 11_200);
});

test("the best exit really is the cheapest fillable one, not just the priciest unit", () => {
  const { best, candidates } = bestExitCurrency(6090, ctx);
  const fillable = candidates.filter((c) => c.fillable);
  assert.ok(fillable.length > 1, "expected several fillable exits to choose between");
  for (const entry of fillable) assert.ok(best.gold <= entry.gold);
});

test("candidates without a rate or a gold cost are dropped, never guessed", () => {
  const { best, candidates } = bestExitCurrency(500, {
    rates: { exalted: 1, chaos: null, divine: 435 },
    goldPerUnit: { exalted: 120, divine: null },
  });
  assert.deepEqual(candidates.map((c) => c.unit), ["divine", "exalted"]);
  // divine has a rate but no gold cost -> unusable; exalted wins by default.
  assert.equal(candidates.find((c) => c.unit === "divine").gold, null);
  assert.equal(best.unit, "exalted");
});

test("a worthless or unpriceable holding yields no recommendation", () => {
  assert.deepEqual(bestExitCurrency(0, ctx), { best: null, candidates: [] });
  assert.deepEqual(bestExitCurrency(null, ctx), { best: null, candidates: [] });
});

test("nothing is fillable when the holding is worth less than every unit", () => {
  const { best } = bestExitCurrency(0.4, { rates: { chaos: 51.5, divine: 435 }, goldPerUnit: GOLD });
  assert.equal(best, null);
});
