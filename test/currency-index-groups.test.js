import test from "node:test";
import assert from "node:assert/strict";

import catalog from "../src/data/catalog-poe2.json" with { type: "json" };
import layout from "../src/data/exchange-layout-poe2.json" with { type: "json" };
import { currencyName } from "../apps/web/lib/market.js";
import { currencyPagePath } from "../apps/web/lib/currency-indexability.js";
import {
  UNMAPPED_CATEGORY,
  exchangePlacement,
  groupCurrenciesByExchangeLayout,
  slugifyGroupName,
} from "../apps/web/lib/currency-index-groups.js";

const catalogEntries = catalog.items.map((item) => ({ id: item.id, name: currencyName(item.id) }));

// The eight live ids that carry a raw metadata path because the identity build
// has no short id for them yet (see apps/web/lib/currency-indexability.js).
// They have no display name the layout would recognise — only the metadata
// lookup can place them, and only `currencyPagePath` can address them.
const metadataIds = layout.items
  .filter((item) => item.metadataId?.startsWith("Metadata/Items/SoulCores/"))
  .slice(0, 4)
  .map((item) => item.metadataId);

test("every entry is grouped exactly once — an index that drops a link is the bug", () => {
  const { categories, total } = groupCurrenciesByExchangeLayout(catalogEntries);
  assert.equal(total, catalogEntries.length);

  const linked = categories.flatMap((c) => c.sections.flatMap((s) => s.rows.map((r) => r.id)));
  assert.equal(linked.length, catalogEntries.length);
  assert.equal(new Set(linked).size, catalogEntries.length, "no id is listed twice");
  for (const entry of catalogEntries) assert.ok(linked.includes(entry.id), `${entry.id} is linked`);
});

test("every href the index emits resolves to the one-segment [id] route", () => {
  // The defect this guards: `/poe2/currencies/${id}` on a raw metadata id emits
  // `/poe2/currencies/Metadata/Items/SoulCores/IdolHawk` — four segments against
  // a one-segment dynamic route, a hard 404 linked from the page whose entire
  // job is crawl signal.
  const ids = [...catalogEntries.map((e) => e.id), ...metadataIds];
  assert.ok(metadataIds.length > 0, "fixture ids found");

  for (const id of ids) {
    const path = currencyPagePath(id);
    const rest = path.slice("/poe2/currencies/".length);
    assert.ok(path.startsWith("/poe2/currencies/"), `${id} -> ${path}`);
    assert.ok(rest.length > 0, `${id} has a non-empty segment`);
    assert.ok(!rest.includes("/"), `${id} addresses exactly one path segment (got ${path})`);
    assert.ok(!/\s/.test(rest), `${id} has no whitespace in its segment`);
    // Whatever the route receives must decode back to the id the data uses.
    assert.equal(decodeURIComponent(rest), id, `${id} round-trips through the URL`);
  }
});

test("a raw metadata id is placed by metadata lookup, not dumped in Other markets", () => {
  for (const metadataId of metadataIds) {
    const placement = exchangePlacement(metadataId, { id: metadataId });
    assert.equal(placement.mapped, true, `${metadataId} is mapped`);
    assert.notEqual(placement.category, UNMAPPED_CATEGORY);
  }

  const { categories } = groupCurrenciesByExchangeLayout(metadataIds.map((id) => ({ id, name: id })));
  assert.ok(
    !categories.some((c) => c.name === UNMAPPED_CATEGORY),
    "metadata-path ids do not fall through to the unmapped bucket",
  );
});

test("a market only the stored exchange_layout knows about is still sectioned", () => {
  // Tomorrow's league: the row reaches the table via our daily cron, but the
  // committed JSON only moves on a monthly PR. Without the stored rows the item
  // would sit in "Other markets" for days — the week it is most searched.
  const overrides = [
    {
      metadataId: "Metadata/Items/Currency/BrandNewLeagueOrb",
      name: "Brand New League Orb",
      normalizedName: "brand new league orb",
      category: "Currency",
      categoryOrder: 0,
      section: "Currency",
      sectionOrder: 0,
      itemOrder: 3,
    },
  ];
  const entries = [{ id: "brand-new-league-orb", name: "Brand New League Orb" }];

  const withoutDb = groupCurrenciesByExchangeLayout(entries);
  assert.equal(withoutDb.categories[0].name, UNMAPPED_CATEGORY, "committed snapshot alone cannot place it");

  const withDb = groupCurrenciesByExchangeLayout(entries, { overrides });
  assert.equal(withDb.categories[0].name, "Currency");
  assert.equal(withDb.categories[0].sections[0].name, "Currency");
  assert.equal(withDb.categories[0].sections[0].rows[0].id, "brand-new-league-orb");

  // And by metadata id, which is how a row with no short id yet is matched.
  const byMetadata = groupCurrenciesByExchangeLayout(
    [{ id: "Metadata/Items/Currency/BrandNewLeagueOrb", name: "Metadata/Items/Currency/BrandNewLeagueOrb" }],
    { overrides },
  );
  assert.equal(byMetadata.categories[0].name, "Currency");
});

test("stored rows never remove what the committed snapshot already placed", () => {
  const overrides = [
    {
      metadataId: "Metadata/Items/Currency/BrandNewLeagueOrb",
      name: "Brand New League Orb",
      normalizedName: "brand new league orb",
      category: "Currency",
      categoryOrder: 0,
      section: "Currency",
      sectionOrder: 0,
      itemOrder: 3,
    },
  ];
  const plain = groupCurrenciesByExchangeLayout(catalogEntries);
  const merged = groupCurrenciesByExchangeLayout(catalogEntries, { overrides });
  const unmappedPlain = plain.categories.find((c) => c.name === UNMAPPED_CATEGORY)?.count ?? 0;
  const unmappedMerged = merged.categories.find((c) => c.name === UNMAPPED_CATEGORY)?.count ?? 0;
  assert.ok(unmappedMerged <= unmappedPlain, "a stored row can only ever place more items, never fewer");
  assert.equal(merged.total, plain.total);
});

test("groups follow the in-game exchange order, unmapped items last", () => {
  const { categories } = groupCurrenciesByExchangeLayout(catalogEntries);

  const orders = categories.map((c) => c.order);
  assert.deepEqual([...orders].sort((a, b) => a - b), orders, "categories are in game order");

  // The snapshot's own first category leads; ours must not invent an order.
  assert.equal(categories[0].name, layout.categories[0].name);
  assert.equal(categories.at(-1).name, UNMAPPED_CATEGORY, "unmapped bucket is last");

  for (const category of categories) {
    const sectionOrders = category.sections.map((s) => s.order);
    assert.deepEqual([...sectionOrders].sort((a, b) => a - b), sectionOrders, `${category.name} sections in order`);
    for (const section of category.sections) {
      const itemOrders = section.rows.map((r) => r.itemOrder);
      assert.deepEqual([...itemOrders].sort((a, b) => a - b), itemOrders, `${section.name} rows in order`);
    }
  }

  const counted = categories.reduce((sum, c) => sum + c.count, 0);
  assert.equal(counted, catalogEntries.length);
});

test("known currencies land in their real exchange section", () => {
  const { categories } = groupCurrenciesByExchangeLayout([
    { id: "divine", name: currencyName("divine") },
    { id: "chaos", name: currencyName("chaos") },
  ]);
  assert.equal(categories.length, 1);
  assert.equal(categories[0].name, "Currency");
  assert.equal(categories[0].sections[0].name, "Currency");
  assert.deepEqual(categories[0].sections[0].rows.map((r) => r.id).sort(), ["chaos", "divine"]);
});

test("an id neither source has seen is still linked, under the unmapped bucket", () => {
  const { categories, total } = groupCurrenciesByExchangeLayout([
    { id: "totally-new-league-orb", name: "Totally New League Orb" },
  ]);
  assert.equal(total, 1);
  assert.equal(categories.length, 1);
  assert.equal(categories[0].name, UNMAPPED_CATEGORY);
  assert.equal(categories[0].sections[0].rows[0].id, "totally-new-league-orb");
});

test("the row carries the caller's payload through untouched", () => {
  const stat = { reference: 12.5, movement: { h24: -0.031 } };
  const { categories } = groupCurrenciesByExchangeLayout([{ id: "divine", name: "Divine Orb", stat }]);
  assert.equal(categories[0].sections[0].rows[0].stat, stat);
});

test("slugs are stable, url-safe anchor ids", () => {
  assert.equal(slugifyGroupName("Jewellers' Currency"), "jewellers-currency");
  assert.equal(slugifyGroupName("Atziri's Temple"), "atziri-s-temple");
  assert.equal(slugifyGroupName(UNMAPPED_CATEGORY), "other-markets");
  assert.equal(slugifyGroupName(""), "group");

  const { categories } = groupCurrenciesByExchangeLayout(catalogEntries);
  const slugs = categories.map((c) => c.slug);
  assert.equal(new Set(slugs).size, slugs.length, "category anchors are unique");
  for (const slug of slugs) assert.match(slug, /^[a-z0-9-]+$/);
});

test("exchangePlacement reports the group a detail page can link back to", () => {
  const divine = exchangePlacement("Divine Orb");
  assert.equal(divine.category, "Currency");
  assert.equal(divine.section, "Currency");
  assert.equal(divine.mapped, true);

  // `mapped: false` is the detail page's guard: it must render NO anchor rather
  // than one pointing at a #fragment the index page does not have.
  const unknown = exchangePlacement("Totally New League Orb");
  assert.equal(unknown.mapped, false);
  assert.equal(unknown.category, UNMAPPED_CATEGORY);
});

test("the two sources together map the large majority of the catalog", () => {
  const { categories } = groupCurrenciesByExchangeLayout(catalogEntries);
  const unmapped = categories.find((c) => c.name === UNMAPPED_CATEGORY)?.count ?? 0;
  const mapped = catalogEntries.length - unmapped;
  // A guard against a name-normalisation regression silently dumping the whole
  // index into "Other markets"; not a claim about any exact coverage number.
  assert.ok(mapped / catalogEntries.length > 0.8, `only ${mapped}/${catalogEntries.length} mapped`);
});
