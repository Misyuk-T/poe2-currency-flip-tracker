import test from "node:test";
import assert from "node:assert/strict";

import { itemFamily, sortByFamily } from "../apps/web/lib/item-family.js";

test("itemFamily strips the tier prefix and ranks the tiers", () => {
  assert.deepEqual(itemFamily("Regal Orb"), { family: "regal orb", tier: 1 });
  assert.deepEqual(itemFamily("Greater Regal Orb"), { family: "regal orb", tier: 2 });
  assert.deepEqual(itemFamily("Perfect Regal Orb"), { family: "regal orb", tier: 3 });
  assert.deepEqual(itemFamily("Lesser Jeweller's Orb"), { family: "jeweller's orb", tier: 0 });
});

test("itemFamily does not mistake a name that merely contains a tier word", () => {
  // "Greater" only counts as a tier when it leads the name.
  assert.equal(itemFamily("Orb of Greater Fortune").family, "orb of greater fortune");
  assert.equal(itemFamily("Orb of Greater Fortune").tier, 1);
});

const row = (targetName, reference) => ({ targetName, reference });

test("sortByFamily keeps every tier of an item adjacent and in tier order", () => {
  const sorted = sortByFamily([
    row("Perfect Regal Orb", 28),
    row("Chaos Orb", 51),
    row("Regal Orb", 1),
    row("Greater Regal Orb", 2),
  ]).map((entry) => entry.targetName);

  const regalRun = sorted.slice(sorted.indexOf("Regal Orb"));
  assert.deepEqual(regalRun, ["Regal Orb", "Greater Regal Orb", "Perfect Regal Orb"]);
});

test("families are ranked by their most valuable member, not by their cheapest", () => {
  const sorted = sortByFamily([
    row("Wisdom Scroll", 0.01),
    row("Regal Orb", 1),
    row("Perfect Regal Orb", 28),
  ]).map((entry) => entry.targetName);

  // The Regal family leads on its Perfect tier (28) despite its base being 1.
  assert.deepEqual(sorted, ["Regal Orb", "Perfect Regal Orb", "Wisdom Scroll"]);
});

test("rows with no usable price sort last instead of throwing", () => {
  const sorted = sortByFamily([
    row("Mystery Item", null),
    row("Divine Orb", 435),
  ]).map((entry) => entry.targetName);
  assert.deepEqual(sorted, ["Divine Orb", "Mystery Item"]);
});

test("sortByFamily is stable for equally-valued rows in one family", () => {
  const rows = [row("Alpha Orb", 5), row("Beta Orb", 5)];
  assert.deepEqual(sortByFamily(rows).map((e) => e.targetName), ["Alpha Orb", "Beta Orb"]);
});
