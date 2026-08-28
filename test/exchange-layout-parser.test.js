import assert from "node:assert/strict";
import test from "node:test";

import { parseExchangeLayoutHtml, preserveKnownMetadataIds } from "../scripts/lib/exchange-layout-parser.mjs";

test("parses category, section, metadata, item order and fractional gold without page chrome", () => {
  const item = (name, metadata, gold) => {
    const hover = encodeURIComponent(`Data\\BaseItemTypes\\${metadata.replaceAll("/", "\\")}`);
    return `<div class="flex-grow-1 ms-2 d-flex justify-content-between align-items-center"><a data-hover="?s=${hover}" href="item">${name}</a><span>${gold}</span></div>`;
  };
  const fillers = Array.from({ length: 18 }, (_, index) => item(`Filler ${index}`, `Metadata/Items/Filler${index}`, "10")).join("");
  const html = `<h4>Currency Exchange</h4>
    <h5>Currency</h5><div class="currency-exchange-subtitle">Currency</div>
    ${item("Orb &amp; One", "Metadata/Items/Currency/One", "1/1000")}${fillers}
    <h5>Runes</h5><div class="currency-exchange-subtitle">Greater Runes</div>
    ${item("Greater Storm Rune", "Metadata/Items/Runes/Storm3", "500")}
    <h5>Sites</h5>`;
  const parsed = parseExchangeLayoutHtml(html, { game: "poe2", sourceUrl: "fixture" });

  assert.deepEqual(parsed.categories.map(({ name }) => name), ["Currency", "Runes"]);
  assert.equal(parsed.items[0].name, "Orb & One");
  assert.equal(parsed.items[0].metadataId, "Metadata/Items/Currency/One");
  assert.equal(parsed.items[0].goldPerUnit, 0.001);
  assert.deepEqual(
    [parsed.items.at(-1).category, parsed.items.at(-1).section, parsed.items.at(-1).categoryOrder, parsed.items.at(-1).sectionOrder],
    ["Runes", "Greater Runes", 1, 0],
  );
});

test("preserves a known metadata id when PoE2DB replaces data-hover with an opaque cache URL", () => {
  const current = {
    items: [{
      name: "Divine Orb",
      normalizedName: "divine orb",
      href: "Divine_Orb",
      metadataId: null,
    }],
  };
  const previous = {
    items: [{
      name: "Divine Orb",
      normalizedName: "divine orb",
      href: "Divine_Orb",
      metadataId: "Metadata/Items/Currency/CurrencyModValues",
    }],
  };

  const merged = preserveKnownMetadataIds(current, previous);

  assert.equal(merged.items[0].metadataId, "Metadata/Items/Currency/CurrencyModValues");
  assert.equal(current.items[0].metadataId, null);
});

test("never carries metadata across a changed item identity", () => {
  const previous = {
    items: [{
      name: "Old League Item",
      normalizedName: "old league item",
      href: "Reused_Item_Page",
      metadataId: "Metadata/Items/OldLeague/OldItem",
    }],
  };
  const current = {
    items: [{
      name: "New League Item",
      normalizedName: "new league item",
      href: "Reused_Item_Page",
      metadataId: null,
    }],
  };

  assert.equal(preserveKnownMetadataIds(current, previous).items[0].metadataId, null);
});
