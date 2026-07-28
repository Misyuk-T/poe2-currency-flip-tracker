import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  identityCategories,
  identityIcons,
  identityNames,
  resolveCurrency,
  metadataForShortId,
  isKnownCurrency,
  humanize,
} from "../src/domain/cx-identity.js";

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

test("PoE1 identity is game-scoped and resolves long-tail names, classes, and official CDN art", () => {
  const scarab = "Metadata/Items/Scarabs/ScarabAnarchy2";
  const resolved = resolveCurrency(scarab, "poe1");
  assert.equal(resolved.name, "Anarchy Scarab of Gigantification");
  assert.equal(resolved.category, "Map Fragment");
  assert.match(resolved.icon, /^https:\/\/web\.poecdn\.com\/image\/Art\/2DItems\//);
  assert.equal(identityNames("poe1")[scarab], resolved.name);
  assert.equal(identityCategories("poe1")[scarab], "Map Fragment");
  assert.equal(identityIcons("poe1")[scarab], resolved.icon);
});

test("PoE1 core currencies keep the canonical short-id bridge", () => {
  assert.equal(resolveCurrency(EXALTED, "poe1").shortId, "exalted");
  assert.equal(metadataForShortId("exalted", "poe1"), EXALTED);
  assert.equal(identityNames("poe1").exalted, "Exalted Orb");
  assert.ok(identityIcons("poe1").exalted);
});

test("the level-1 uncut skill gem the exchange trades carries the catalog short id", () => {
  // Its quest twin shares the display name and used to win the name join, which
  // left the traded item uncanonicalised and stranded in a one-item category
  // called "Uncut Skill Gem Stackable" instead of joining levels 2-20.
  assert.equal(resolveCurrency("Metadata/Items/Gems/SkillGemUncut1").shortId, "uncut-skill-gem-1");
  assert.equal(resolveCurrency("Metadata/Items/Gems/SkillGemUncutQuest1").shortId, null);
  assert.equal(metadataForShortId("uncut-skill-gem-1"), "Metadata/Items/Gems/SkillGemUncut1");
});

test("no trade short id is claimed by two Metadata ids", () => {
  for (const game of ["poe1", "poe2"]) {
    const owners = new Map();
    const items = JSON.parse(readFileSync(new URL(`../src/data/cx-identity-${game}.json`, import.meta.url), "utf8")).items;
    for (const [meta, entry] of Object.entries(items)) {
      if (!entry.shortId) continue;
      const existing = owners.get(entry.shortId);
      assert.equal(existing, undefined, `${entry.shortId} claimed by ${existing} and ${meta}`);
      owners.set(entry.shortId, meta);
    }
  }
});

test("no data file is resolved at module scope, and humanize needs no data at all", () => {
  // Both halves of the production failure. Importing cx-identity.js threw in
  // Next's bundled page runtime, where `import.meta.url` is not a URL the
  // constructor accepts — and market-radar.js dragged that import in for
  // humanize(), a pure string function, so every currency page lost its data.
  for (const file of ["src/domain/cx-identity.js", "src/domain/catalog.js"]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(
      source,
      /^(?:const|let|var)\s+\w+\s*=\s*fileURLToPath/m,
      `${file} resolves a path at module scope; resolve it inside the reader instead`,
    );
  }
  const radar = readFileSync(new URL("../src/domain/market-radar.js", import.meta.url), "utf8");
  assert.doesNotMatch(radar, /from "\.\/cx-identity\.js"/, "market-radar must not import the identity reader");
});
