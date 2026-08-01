import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { exchangeLayoutCategories, resolveExchangeLayout } from "../src/domain/exchange-layout.js";

function snapshot(game) {
  return JSON.parse(readFileSync(new URL(`../src/data/exchange-layout-${game}.json`, import.meta.url), "utf8"));
}

test("PoE 2 snapshot follows the in-game sidebar and never invents Popular", () => {
  const poe2 = snapshot("poe2");
  assert.deepEqual(exchangeLayoutCategories("poe2").map(({ name }) => name), [
    "Currency", "Essences", "Delirium", "Breach", "Abyss", "Atziri's Temple", "Fragments",
    "Runes", "Ritual", "Soul Cores", "Idols", "Uncut Gems", "Expedition", "Gems",
  ]);
  assert.ok(poe2.items.filter(({ metadataId }) => metadataId).length > 500);
});

test("PoE 2 items resolve to the exact in-game category and section", () => {
  const expected = [
    ["Panther Idol", "Idols", "Idols"],
    ["Carved Cunning", "Idols", "Ritual"],
    ["Guatelitzi's Thesis", "Atziri's Temple", "Soul Cores"],
    ["Omen of Answered Prayers", "Ritual", "Special Omens"],
    ["Head of the King", "Ritual", "Pinnacle Fragments"],
    ["Call of the Shadows", "Fragments", "Pinnacle Fragments"],
    ["Cowardly Fate", "Fragments", "Ultimatum Fragments"],
    ["Aldur's Saga", "Expedition", "Omens"],
    ["Verisium", "Expedition", "Verisium"],
    ["Eonyr's Thunder", "Gems", "Lineage Support Gems"],
  ];
  for (const [name, category, section] of expected) {
    const resolved = resolveExchangeLayout({ target: `fixture:${name}`, targetName: name, category: "Stackable Currency" }, "poe2");
    assert.deepEqual([resolved.category, resolved.subcategory, resolved.layoutSource], [category, section, "game-client-layout"], name);
  }
});

test("PoE 1 snapshot maps ordinary currency and preserves its own client order", () => {
  const chaos = resolveExchangeLayout({ target: "chaos", targetName: "Chaos Orb", category: "Currency" }, "poe1");
  assert.deepEqual([chaos.category, chaos.subcategory, chaos.categoryOrder], ["Currency", "Currency", 0]);
});

test("an unseen item is visible as unclassified with technical provenance preserved", () => {
  const resolved = resolveExchangeLayout({ target: "future-item", targetName: "Future League Thing", category: "Stackable Currency", subcategory: "Technical" }, "poe2");
  assert.equal(resolved.category, "Needs classification");
  assert.equal(resolved.subcategory, "Needs classification");
  assert.equal(resolved.tradeCategory, "Stackable Currency");
  assert.equal(resolved.tradeSubcategory, "Technical");
  assert.equal(resolved.layoutSource, "unmapped-exchange-item");
});
