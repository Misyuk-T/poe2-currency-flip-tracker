import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveCurrency, metadataForShortId, isKnownCurrency, humanize } from "../src/domain/cx-identity.js";

const EXALTED = "Metadata/Items/Currency/CurrencyAddModToRare";
const DIVINE = "Metadata/Items/Currency/CurrencyModValues";
const SOULCORE = "Metadata/Items/SoulCores/RuneWardSpecial3";

test("resolves the anchor correctly (the catalog bridge got this WRONG)", () => {
  const ex = resolveCurrency(EXALTED);
  assert.equal(ex.name, "Exalted Orb");
  assert.equal(ex.shortId, "exalted");
  assert.ok(ex.icon && ex.icon.startsWith("https://www.pathofexile.com/gen/image/"));
});

test("resolves a currency-core item with name + short id + official icon", () => {
  const div = resolveCurrency(DIVINE);
  assert.equal(div.name, "Divine Orb");
  assert.equal(div.shortId, "divine");
  assert.ok(div.icon);
});

test("resolves a long-tail item (soul core) by name even without a catalog icon", () => {
  const sc = resolveCurrency(SOULCORE);
  assert.match(sc.name, /Rune|Warding/);
  assert.equal(sc.id, SOULCORE);
});

test("unknown Metadata id falls back to a humanized name, never a raw path", () => {
  const r = resolveCurrency("Metadata/Items/Currency/CurrencyTotallyMadeUpXyz");
  assert.equal(r.name, "Currency Totally Made Up Xyz");
  assert.equal(r.shortId, null);
  assert.equal(r.icon, null);
  assert.equal(isKnownCurrency("Metadata/Items/Currency/CurrencyTotallyMadeUpXyz"), false);
});

test("metadataForShortId bridges the anchor back to its Metadata path", () => {
  assert.equal(metadataForShortId("exalted"), EXALTED);
  assert.equal(metadataForShortId("divine"), DIVINE);
  assert.equal(metadataForShortId("no-such-id"), null);
});

test("humanize splits camelCase and letter/digit boundaries", () => {
  assert.equal(humanize("Metadata/Items/Currency/CurrencyRerollRare"), "Currency Reroll Rare");
  assert.equal(humanize("Metadata/Items/SoulCores/RuneWardSpecial3"), "Rune Ward Special 3");
});

test("tiered variants keep their OWN short id, not the base's (collision fix)", () => {
  // The art-path join wrongly gave Greater/Perfect Exalted the base "exalted".
  // The name join must give each its own id (or none) — never the base's.
  for (const meta of ["Metadata/Items/Currency/CurrencyAddModToRare2", "Metadata/Items/Currency/CurrencyAddModToRare3"]) {
    const r = resolveCurrency(meta);
    if (r.shortId != null) assert.notEqual(r.shortId, "exalted");
  }
  assert.equal(resolveCurrency("Metadata/Items/Currency/CurrencyAddModToRare2").name, "Greater Exalted Orb");
});

test("built short ids are unique (1:1 reverse bridge invariant)", () => {
  const data = JSON.parse(
    readFileSync(new URL("../src/data/cx-identity-poe2.json", import.meta.url)),
  );
  const seen = new Map();
  for (const [meta, e] of Object.entries(data.items)) {
    if (!e.shortId) continue;
    assert.equal(seen.has(e.shortId), false, `duplicate shortId ${e.shortId}: ${seen.get(e.shortId)} vs ${meta}`);
    seen.set(e.shortId, meta);
  }
});
