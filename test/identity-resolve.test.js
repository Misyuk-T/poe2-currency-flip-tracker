import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import catalog from "../src/data/catalog-poe2.json" with { type: "json" };
import { artFromDds, assignShortIds, buildIdentityEntries, catalogIndexByName, nameKey } from "../src/domain/identity-resolve.js";

const committed = JSON.parse(
  readFileSync(fileURLToPath(new URL("../src/data/cx-identity-poe2.json", import.meta.url)), "utf8"),
);

const EXALTED = "Metadata/Items/Currency/CurrencyAddModToRare";
const GREATER_EXALTED = "Metadata/Items/Currency/CurrencyAddModToRare2";

test("art paths lose their Art/ prefix and .dds suffix; anything else is null", () => {
  assert.equal(artFromDds("Art/2DItems/Currency/CurrencyAddModToRare.dds"), "2DItems/Currency/CurrencyAddModToRare");
  assert.equal(artFromDds("Art/2DItems/X.DDS"), "2DItems/X");
  assert.equal(artFromDds(undefined), null);
});

test("the catalog index joins on the normalized display name, first entry winning", () => {
  const index = catalogIndexByName([
    { id: "first", name: "  Exalted   Orb ", image: "a.png" },
    { id: "second", name: "exalted orb", image: "b.png" },
    { id: "nameless", image: "c.png" },
  ]);
  assert.equal(index.size, 1);
  assert.deepEqual(index.get(nameKey("Exalted Orb")), { image: "a.png", id: "first" });
});

test("a contested name gives its short id to the id the exchange actually trades", () => {
  const catalogByName = catalogIndexByName([{ id: "uncut-skill-gem-1", name: "Uncut Skill Gem", image: null }]);
  const baseItems = {
    "Metadata/Items/Gems/SkillGemUncutQuest1": { name: "Uncut Skill Gem" },
    "Metadata/Items/Gems/SkillGemUncut1": { name: "Uncut Skill Gem" },
  };
  const traded = assignShortIds({ baseItems, catalogByName, tradedIds: new Set(["Metadata/Items/Gems/SkillGemUncut1"]) });
  assert.equal(traded.contested, 1);
  assert.deepEqual([...traded.shortIdOwner], [["Metadata/Items/Gems/SkillGemUncut1", "uncut-skill-gem-1"]]);

  // With no live exchange to ask, the choice must still be repeatable.
  const blind = assignShortIds({ baseItems, catalogByName, tradedIds: new Set() });
  assert.deepEqual([...blind.shortIdOwner], [["Metadata/Items/Gems/SkillGemUncut1", "uncut-skill-gem-1"]]);
});

test("PoE2 options attach the catalog icon and short id; PoE1 options attach neither", () => {
  const baseItems = {
    [EXALTED]: {
      name: "Exalted Orb",
      item_class: "Stackable Currency",
      visual_identity: { dds_file: "Art/2DItems/Currency/CurrencyAddModToRare.dds" },
    },
  };
  const catalogItems = [{ id: "exalted", name: "Exalted Orb", category: "Currency", image: "https://example.test/ex.png" }];

  const poe2 = buildIdentityEntries({
    baseItems,
    catalogItems,
    observedIds: new Set([EXALTED]),
    joinShortIdsByName: true,
    attachCatalogIcon: true,
  });
  assert.deepEqual(poe2.items[EXALTED], {
    name: "Exalted Orb",
    class: "Stackable Currency",
    art: "2DItems/Currency/CurrencyAddModToRare",
    shortId: "exalted",
    icon: "https://example.test/ex.png",
    category: "Currency",
    taxonomySource: "official-id",
    taxonomyConfidence: 1,
  });
  assert.deepEqual(poe2.stats, {
    named: 1,
    iconed: 1,
    withArt: 1,
    contested: 0,
    taxonomyCounts: { "official-id": 1 },
  });

  const poe1 = buildIdentityEntries({
    baseItems,
    catalogItems,
    observedIds: new Set([EXALTED]),
    coreShortIds: { [EXALTED]: "exalted" },
  });
  assert.equal("icon" in poe1.items[EXALTED], false, "PoE1 rows carry no icon key; the runtime derives one from art");
  assert.equal(poe1.items[EXALTED].shortId, "exalted");
});

test("an id the exchange lists but RePoE has never heard of still gets a humanized row", () => {
  const unknown = "Metadata/Items/Currency/CurrencyTotallyMadeUpXyz";
  const { items } = buildIdentityEntries({
    baseItems: {},
    catalogItems: [],
    observedIds: new Set([unknown]),
  });
  assert.equal(items[unknown].name, "Currency Totally Made Up Xyz");
  assert.deepEqual([items[unknown].class, items[unknown].art, items[unknown].shortId, items[unknown].category], [
    null,
    null,
    null,
    null,
  ]);
  assert.equal(items[unknown].taxonomySource, "unresolved");
});

/**
 * The real regression guard for "the build script's output must not move": the
 * WHOLE committed map is fed back through the shared resolver as if it had just
 * come off RePoE, alongside the real committed catalog, and must come out
 * identical — name, class, art, icon, short id, category AND taxonomySource.
 * Offline: the upstream documents are not available in CI, but the committed
 * artefact carries everything they contributed.
 *
 * Two groups of ids are excluded, and both exclusions are the point rather than
 * a fudge, because both depend on the live exchange, which a test cannot have:
 *
 *   - `learned-prefix` entries (5 of 4825). Prefix learning is seeded from the
 *     ids GGG currently lists markets for; without that set nothing is learned.
 *   - ids whose display name is carried by more than one Metadata id (contested
 *     names). `chooseShortIdOwner` asks the exchange which twin is real, and with
 *     no exchange it falls back to a stable sort — which can hand the short id,
 *     and with it `official-id` vs `official-name`, to the other twin.
 *
 * Everything else — 4355 ids — must round-trip exactly. Category and
 * taxonomySource are asserted deliberately: they are the fields the identity job
 * writes into a table that outranks this file, so a drift here is a drift that
 * would become permanent in production.
 */
test("re-resolving the committed map against the real catalog reproduces it exactly", () => {
  const ids = Object.keys(committed.items);
  const nameCounts = new Map();
  for (const id of ids) {
    const key = nameKey(committed.items[id].name);
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }
  const exchangeIndependent = (id) =>
    committed.items[id].taxonomySource !== "learned-prefix" &&
    nameCounts.get(nameKey(committed.items[id].name)) === 1;

  const baseItems = {};
  for (const id of ids) {
    const entry = committed.items[id];
    baseItems[id] = {
      name: entry.name,
      item_class: entry.class,
      ...(entry.art ? { visual_identity: { dds_file: `Art/${entry.art}.dds` } } : {}),
    };
  }
  const { items } = buildIdentityEntries({
    baseItems,
    catalogItems: catalog.items,
    // Empty on purpose: see the exclusions above. Seeding this with anything
    // other than the ids GGG actually trades changes categories — feeding it all
    // 4825 committed ids moves 1056 of them.
    observedIds: new Set(),
    joinShortIdsByName: true,
    attachCatalogIcon: true,
  });

  const checked = ids.filter(exchangeIndependent);
  assert.ok(checked.length > 4_000, `expected most of the map to be checkable, got ${checked.length}`);
  // `official-name` is excluded as a class, not by accident: resolving by name
  // instead of by id is what a contested name looks like, so every such entry
  // falls into the exchange-dependent group above.
  const sources = new Set(checked.map((id) => committed.items[id].taxonomySource));
  for (const source of ["official-id", "official-path-token", "repo-class"]) {
    assert.ok(sources.has(source), `expected the checked set to cover ${source}, got ${[...sources]}`);
  }

  for (const id of checked) {
    const expected = committed.items[id];
    const actual = items[id];
    assert.deepEqual(
      [actual.name, actual.class, actual.art, actual.icon, actual.shortId, actual.category, actual.taxonomySource],
      [expected.name, expected.class, expected.art, expected.icon, expected.shortId, expected.category, expected.taxonomySource],
      `identity drifted for ${id}`,
    );
  }

  assert.equal(items[EXALTED].name, "Exalted Orb");
  assert.equal(items[GREATER_EXALTED].name, "Greater Exalted Orb");
  // The tier variants share one piece of art, which is precisely why the join is
  // on the display name and not on the art path: the short ids must still differ.
  assert.notEqual(items[EXALTED].shortId, items[GREATER_EXALTED].shortId);
});
