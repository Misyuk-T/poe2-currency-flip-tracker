import test from "node:test";
import assert from "node:assert/strict";
import { catalogTaxonomy } from "../src/domain/catalog-taxonomy.js";

const t = (name, category) => catalogTaxonomy({ name, category });

test("runes follow player-facing progression before special families", () => {
  const lesser = t("Lesser Desert Rune", "Runes");
  const standard = t("Desert Rune", "Runes");
  const greater = t("Greater Desert Rune", "Runes");
  const perfect = t("Perfect Desert Rune", "Runes");
  assert.deepEqual([lesser.subcategory, standard.subcategory, greater.subcategory, perfect.subcategory], [
    "Lesser runes", "Standard runes", "Greater runes", "Perfect runes",
  ]);
  assert.ok(lesser.catalogOrder < standard.catalogOrder);
  assert.ok(standard.catalogOrder < greater.catalogOrder);
  assert.ok(greater.catalogOrder < perfect.catalogOrder);
  assert.equal(t("Ancient Rune of Splinters", "Runes").subcategory, "Ancient runes");
  assert.equal(t("Legacy of Bramblejack", "Runes").subcategory, "Legacy runes");
});

test("tiered categories expose natural subcategories and numeric level order", () => {
  assert.equal(t("Greater Essence of Haste", "Essences").subcategory, "Greater essences");
  assert.equal(t("Refined Esh's Catalyst", "Breach").subcategory, "Refined catalysts");
  assert.equal(t("Ancient Liquid Envy", "Delirium").subcategory, "Ancient liquids");
  assert.ok(t("Uncut Skill Gem (Level 9)", "Uncut Gems").catalogOrder < t("Uncut Skill Gem (Level 10)", "Uncut Gems").catalogOrder);
  assert.ok(t("Waystone (Tier 2)", "Waystones").catalogOrder < t("Waystone (Tier 12)", "Waystones").catalogOrder);
});
