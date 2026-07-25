import { test } from "node:test";
import assert from "node:assert/strict";

import { createGoldRegistry, validateShortlistCoverage } from "../src/domain/gold-costs.js";
import { POE2_GOLD_COSTS } from "../src/data/gold-costs-poe2.js";

const reg = createGoldRegistry(POE2_GOLD_COSTS, { game: "poe2" });

test("Fix 4: every gold-table currency is present, versioned, and a real trade id", () => {
  // ids reconciled against GGG trade2 data/static (greater-exalted-orb,
  // fracturing-orb); "perfect-exalted" was a guess and is not a real item.
  for (const id of ["exalted", "chaos", "divine", "greater-exalted-orb", "fracturing-orb", "mirror"]) {
    assert.ok(reg.has(id), `missing gold cost for ${id}`);
    const record = reg.record(id);
    assert.ok(record.effectiveFrom && record.source, `unsourced record for ${id}`);
    assert.ok(Number.isInteger(record.goldPerUnit));
  }
  assert.equal(reg.has("perfect-exalted"), false); // dropped: not in the catalog
});

test("Fix 4: coverage validation surfaces gaps without guessing", () => {
  // "vaal" is now a real, sourced entry (2026-07-25 poe2db.tw expansion);
  // "not-a-real-item" stands in for the still-genuine gap case.
  const cov = validateShortlistCoverage(reg, {
    anchorCurrency: "exalted",
    shortlist: ["divine", "chaos", "vaal", "not-a-real-item"],
  });
  assert.equal(cov.anchorCovered, true);
  assert.deepEqual(cov.covered, ["divine", "chaos", "vaal"]);
  assert.deepEqual(cov.missing, ["not-a-real-item"]); // no verified cost -> reported, not invented
  assert.equal(reg.goldPerUnit("not-a-real-item"), undefined);
});

test("Fix 4: the 2026-07-25 poe2db.tw expansion covers hundreds of items, not just the anchors", () => {
  assert.ok(POE2_GOLD_COSTS.length > 600, `expected a large table, got ${POE2_GOLD_COSTS.length}`);
});
