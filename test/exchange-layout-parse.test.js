import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  LAYOUT_SOURCE_URLS,
  exchangeLayoutItemKey,
  parseExchangeLayoutHtml,
} from "../src/domain/exchange-layout-parse.js";
import {
  categoriesFromItems,
  committedExchangeLayout,
  mergeExchangeLayoutItems,
} from "../src/domain/exchange-layout.js";

const GAMES = ["poe1", "poe2"];

const snapshot = (game) =>
  JSON.parse(readFileSync(new URL(`../src/data/exchange-layout-${game}.json`, import.meta.url), "utf8"));

const escapeText = (value) =>
  String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/**
 * Re-render a committed snapshot as the markup PoEDB/PoE2DB serve, so the SHARED
 * parser can be driven over the real, full-size data instead of a toy fixture.
 * Only the shapes the parser keys on are reproduced: the h4 anchor, h5 category
 * headings, the subtitle divs that open a section, and the item row whose text
 * anchor is immediately followed by its gold span.
 */
function layoutHtmlFromSnapshot(snap) {
  const parts = ["<h4>Currency Exchange</h4>"];
  let category = null;
  let section = null;
  for (const item of snap.items) {
    if (item.category !== category) {
      category = item.category;
      section = null;
      parts.push(`<h5>${escapeText(category)}</h5>`);
    }
    if (item.section !== section) {
      section = item.section;
      parts.push(`<div class="currency-exchange-subtitle">${escapeText(section)}</div>`);
    }
    const hover = item.metadataId
      ? ` data-hover="?s=${encodeURIComponent(`Data\\BaseItemTypes\\${item.metadataId.replaceAll("/", "\\")}`)}"`
      : "";
    parts.push(
      '<div class="flex-grow-1 ms-2 d-flex justify-content-between align-items-center">'
      + `<a${hover} href="${escapeText(item.href ?? "")}">${escapeText(item.name)}</a>`
      + `<span>${escapeText(item.goldFeeText)}</span></div>`,
    );
  }
  // Page chrome after the exchange card: the parser must drop it, exactly as it
  // does on the live page.
  parts.push("<h5>Sites</h5><h5>Tools</h5>");
  return parts.join("");
}

const ITEM_FIELDS = [
  "name",
  "normalizedName",
  "metadataId",
  "href",
  "goldFeeText",
  "goldPerUnit",
  "category",
  "section",
  "categoryOrder",
  "sectionOrder",
  "itemOrder",
];

for (const game of GAMES) {
  test(`${game}: the shared parser round-trips the committed snapshot field for field`, () => {
    const committed = snapshot(game);
    const parsed = parseExchangeLayoutHtml(layoutHtmlFromSnapshot(committed), {
      game,
      sourceUrl: LAYOUT_SOURCE_URLS[game],
    });

    assert.equal(parsed.game, game);
    assert.equal(parsed.source, LAYOUT_SOURCE_URLS[game]);
    assert.equal(parsed.itemCount, committed.itemCount);
    assert.equal(parsed.items.length, committed.items.length);

    // Field for field over every one of the 669/1126 items — not a spot check.
    // A regression in gold parsing, name decoding, metadata extraction or ANY of
    // the three order counters fails here.
    for (let index = 0; index < committed.items.length; index += 1) {
      const expected = committed.items[index];
      const actual = parsed.items[index];
      for (const field of ITEM_FIELDS) {
        assert.deepEqual(actual[field], expected[field], `${game} item ${index} (${expected.name}) field ${field}`);
      }
    }
    assert.deepEqual(parsed.categories, committed.categories, `${game} category/section tree`);
  });

  test(`${game}: the sidebar tree derives exactly from the items, so migration 011 needs no second table`, () => {
    const committed = snapshot(game);
    assert.deepEqual(categoriesFromItems(committed.items), committed.categories);
  });

  test(`${game}: every committed item has a stable, unique key`, () => {
    const committed = snapshot(game);
    const keys = committed.items.map((item) => exchangeLayoutItemKey(item));
    assert.ok(keys.every(Boolean), "no item may fail to produce a key");
    assert.equal(new Set(keys).size, keys.length, "keys collide, so a stored row would shadow a different item");
  });

  test(`${game}: committedExchangeLayout reads the same file the parser round-trips`, () => {
    assert.deepEqual(committedExchangeLayout(game).items.length, snapshot(game).items.length);
  });
}

test("PoE1's two same-named Delirium Orbs stay distinct rows", () => {
  // The reason the key is "Metadata id, else normalized name" rather than just
  // the name: these two differ only by Metadata id and gold fee.
  const duplicates = snapshot("poe1").items.filter((item) => item.normalizedName === "delirium orb");
  assert.equal(duplicates.length, 2);
  assert.equal(new Set(duplicates.map(exchangeLayoutItemKey)).size, 2);
});

test("a stored row overrides per field and never blanks the committed answer", () => {
  const committed = [
    {
      name: "Orb of Alchemy",
      normalizedName: "orb of alchemy",
      metadataId: "Metadata/Items/Currency/CurrencyUpgradeToRare",
      href: "Orb_of_Alchemy",
      category: "Currency",
      section: "Currency",
      categoryOrder: 0,
      sectionOrder: 0,
      itemOrder: 3,
    },
    {
      name: "Untouched Orb",
      normalizedName: "untouched orb",
      metadataId: "Metadata/Items/Currency/Untouched",
      href: "Untouched_Orb",
      category: "Currency",
      section: "Currency",
      categoryOrder: 0,
      sectionOrder: 0,
      itemOrder: 4,
    },
  ];
  const merged = mergeExchangeLayoutItems(committed, [
    // Moved to a new section by a patch, but the row carries no href.
    {
      metadataId: "Metadata/Items/Currency/CurrencyUpgradeToRare",
      name: "Orb of Alchemy",
      normalizedName: "orb of alchemy",
      href: null,
      category: "Currency",
      section: "Quality Currency",
      categoryOrder: 0,
      sectionOrder: 3,
      itemOrder: 0,
    },
    // An item the committed snapshot has never heard of.
    {
      metadataId: "Metadata/Items/Currency/BrandNew",
      name: "Brand New Orb",
      normalizedName: null,
      category: "Currency",
      section: "Currency",
      categoryOrder: 0,
      sectionOrder: 0,
      itemOrder: 9,
    },
  ]);

  const alchemy = merged.find((item) => item.metadataId === "Metadata/Items/Currency/CurrencyUpgradeToRare");
  assert.equal(alchemy.section, "Quality Currency", "the stored section wins");
  assert.equal(alchemy.sectionOrder, 3);
  assert.equal(alchemy.href, "Orb_of_Alchemy", "a null stored column leaves the committed value standing");

  const untouched = merged.find((item) => item.metadataId === "Metadata/Items/Currency/Untouched");
  assert.deepEqual(untouched, committed[1], "an item with no stored row is untouched");

  const fresh = merged.find((item) => item.metadataId === "Metadata/Items/Currency/BrandNew");
  assert.equal(fresh.normalizedName, "brand new orb", "a missing normalized name is derived, not left null");
  assert.equal(merged.length, 3);
});

test("no overrides at all returns the committed items unchanged, by identity", () => {
  const committed = snapshot("poe2").items;
  assert.equal(mergeExchangeLayoutItems(committed, []), committed);
  assert.equal(mergeExchangeLayoutItems(committed, null), committed);
});
