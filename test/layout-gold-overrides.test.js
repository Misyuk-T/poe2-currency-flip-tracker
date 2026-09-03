import assert from "node:assert/strict";
import test from "node:test";

import {
  applyExchangeLayout,
  committedExchangeLayout,
  exchangeLayoutCategories,
} from "../src/domain/exchange-layout.js";
import { catalogWithGold } from "../apps/web/lib/radar-backend.js";
import {
  loadLayoutOverrides,
  readLayoutOverridesCached,
  resetLayoutOverridesCache,
} from "../apps/web/lib/layout-overrides.js";
import {
  loadGoldOverrides,
  readGoldOverridesCached,
  resetGoldOverridesCache,
} from "../apps/web/lib/gold-overrides.js";
import { POE2_GOLD_COSTS } from "../src/data/gold-costs-poe2.js";

const CONFIG = {
  poeGame: "poe2",
  poeRealm: "poe2",
  league: "Runes of Aldur",
  poe1League: "Standard",
  providerMode: "live",
  cxapiStreams: [{ game: "poe2", realm: "poe2" }],
};
const NOW = Date.parse("2026-09-03T05:00:00Z");
const FETCHED = Date.parse("2026-09-03T04:40:00Z");
const silent = () => {};

const layoutRepo = (rows, { onRead = () => {}, error = null } = {}) => () => ({
  readExchangeLayout: async () => {
    onRead();
    if (error) throw error;
    return rows;
  },
});
const goldRepo = (rows, { onRead = () => {}, error = null } = {}) => () => ({
  readGoldCosts: async () => {
    onRead();
    if (error) throw error;
    return rows;
  },
});

const layoutRow = (extra = {}) => ({
  itemKey: extra.metadataId ?? extra.itemKey ?? "brand new orb",
  metadataId: null,
  name: "Brand New Orb",
  normalizedName: "brand new orb",
  href: "Brand_New_Orb",
  category: "Currency",
  categoryOrder: 0,
  section: "Currency",
  sectionOrder: 0,
  itemOrder: 99,
  source: "https://poe2db.tw/us/Currency_Exchange",
  fetchedAt: FETCHED,
  ...extra,
});

const goldRow = (extra = {}) => ({
  itemKey: "chaos",
  displayName: "Chaos Orb",
  goldPerUnit: 4242,
  source: "https://poe2db.tw/us/Currency_Exchange",
  fetchedAt: FETCHED,
  ...extra,
});

test("layout loader: a stored row places a row the committed snapshot has never seen", async () => {
  resetLayoutOverridesCache();
  const overrides = await loadLayoutOverrides("poe2", {
    config: CONFIG,
    trace: silent,
    now: NOW,
    makeRepo: layoutRepo([layoutRow({ itemKey: "Metadata/Items/Currency/BrandNew", metadataId: "Metadata/Items/Currency/BrandNew" })]),
  });

  const row = { target: "Metadata/Items/Currency/BrandNew", targetName: "Brand New Orb" };
  const unmapped = applyExchangeLayout([row], "poe2")[0];
  assert.equal(unmapped.layoutSource, "unmapped-exchange-item");
  assert.equal(unmapped.category, "Needs classification");

  const placed = applyExchangeLayout([row], "poe2", { overrides })[0];
  assert.equal(placed.layoutSource, "game-client-layout");
  assert.deepEqual(
    [placed.category, placed.subcategory, placed.categoryOrder, placed.sectionOrder, placed.itemOrder],
    ["Currency", "Currency", 0, 0, 99],
  );
});

test("layout loader: an item with no stored row keeps its committed placement", async () => {
  resetLayoutOverridesCache();
  const committed = committedExchangeLayout("poe2");
  const untouched = committed.items.find((item) => item.metadataId && item.itemOrder > 0);
  const overrides = await loadLayoutOverrides("poe2", {
    config: CONFIG,
    trace: silent,
    now: NOW,
    makeRepo: layoutRepo([layoutRow({ itemKey: "Metadata/Items/Currency/BrandNew", metadataId: "Metadata/Items/Currency/BrandNew" })]),
  });
  const resolved = applyExchangeLayout([{ target: untouched.metadataId }], "poe2", { overrides })[0];
  assert.deepEqual(
    [resolved.category, resolved.subcategory, resolved.itemOrder],
    [untouched.category, untouched.section, untouched.itemOrder],
  );
});

test("layout loader: a stored move is reflected in the rows AND the sidebar together", async () => {
  resetLayoutOverridesCache();
  const committed = committedExchangeLayout("poe2");
  const moved = committed.items.find((item) => item.metadataId);
  const overrides = await loadLayoutOverrides("poe2", {
    config: CONFIG,
    trace: silent,
    now: NOW,
    makeRepo: layoutRepo([
      layoutRow({
        itemKey: moved.metadataId,
        metadataId: moved.metadataId,
        name: moved.name,
        normalizedName: moved.normalizedName,
        category: "Currency",
        categoryOrder: 0,
        section: "Brand New Section",
        sectionOrder: 9,
        itemOrder: 0,
      }),
    ]),
  });

  const resolved = applyExchangeLayout([{ target: moved.metadataId }], "poe2", { overrides })[0];
  assert.equal(resolved.subcategory, "Brand New Section");

  const categories = exchangeLayoutCategories("poe2", { overrides });
  const currency = categories.find((category) => category.name === "Currency");
  assert.ok(
    currency.sections.some((section) => section.name === "Brand New Section"),
    "a row grouped under a section the sidebar does not list would render as an empty group",
  );
  // And the committed call is untouched by the merge.
  assert.equal(
    exchangeLayoutCategories("poe2").find((category) => category.name === "Currency").sections
      .some((section) => section.name === "Brand New Section"),
    false,
  );
});

test("layout loader: a row that cannot place anything is not carried into the merge", async () => {
  resetLayoutOverridesCache();
  const entry = await readLayoutOverridesCached("poe2", {
    config: CONFIG,
    trace: silent,
    now: NOW,
    makeRepo: layoutRepo([
      layoutRow({ itemKey: "no placement", category: null, section: null }),
      layoutRow({ itemKey: "Metadata/Items/Currency/BrandNew", metadataId: "Metadata/Items/Currency/BrandNew" }),
    ]),
  });
  assert.equal(entry.rows, 1);
  assert.equal(entry.fetchedAt, FETCHED);
});

test("layout loader: a missing table is a traced, expected, empty result", async () => {
  resetLayoutOverridesCache();
  const traced = [];
  const error = Object.assign(new Error('relation "exchange_layout" does not exist'), { code: "42P01" });
  const entry = await readLayoutOverridesCached("poe2", {
    config: CONFIG,
    trace: (phase) => traced.push(phase),
    now: NOW,
    makeRepo: layoutRepo([], { error }),
  });
  assert.deepEqual(traced, ["exchange-layout.table-missing"]);
  assert.deepEqual(entry.items, []);
  assert.equal(entry.rows, 0);
  // And the empty result is transparent to every consumer.
  assert.deepEqual(exchangeLayoutCategories("poe2", { overrides: entry.items }), exchangeLayoutCategories("poe2"));
});

test("layout loader: no database at all is not an error, just no overrides", async () => {
  resetLayoutOverridesCache();
  const entry = await readLayoutOverridesCached("poe2", {
    config: CONFIG, trace: silent, now: NOW, makeRepo: () => null,
  });
  assert.deepEqual([entry.items, entry.rows, entry.error], [[], 0, null]);
});

test("layout loader: concurrent cold requests issue ONE read, and the TTL holds it", async () => {
  resetLayoutOverridesCache();
  let reads = 0;
  const makeRepo = layoutRepo([layoutRow()], { onRead: () => { reads += 1; } });
  const options = { config: CONFIG, trace: silent, now: NOW, makeRepo };

  const results = await Promise.all(Array.from({ length: 8 }, () => loadLayoutOverrides("poe2", options)));
  assert.equal(reads, 1, "single-flight: the in-flight promise is cached before it is awaited");
  // The SAME array object, which is what lets the merged store be memoized.
  for (const result of results) assert.equal(result, results[0]);

  await loadLayoutOverrides("poe2", { ...options, now: NOW + 599_000 });
  assert.equal(reads, 1, "still inside the 10-minute TTL");
  await loadLayoutOverrides("poe2", { ...options, now: NOW + 600_001 });
  assert.equal(reads, 2, "the TTL expired");

  resetLayoutOverridesCache("poe2");
  await loadLayoutOverrides("poe2", options);
  assert.equal(reads, 3, "a job write invalidates the cache immediately");
});

test("gold loader: a stored cost outranks the committed table, and the rest is untouched", async () => {
  resetGoldOverridesCache();
  const records = await loadGoldOverrides("poe2", {
    config: CONFIG, trace: silent, now: NOW, makeRepo: goldRepo([goldRow()]),
  });
  assert.equal(records.length, 1);
  assert.deepEqual(
    [records[0].itemId, records[0].goldPerUnit, records[0].effectiveFrom],
    ["chaos", 4242, "2026-09-03"],
  );

  const ctx = {
    config: CONFIG,
    catalog: { items: [{ id: "chaos", name: "Chaos Orb", category: "Currency" }, { id: "divine", name: "Divine Orb", category: "Currency" }] },
    goldPlaceholder: false,
    catalogManifest: [],
    catalogById: new Map(),
  };
  const { catalogById } = catalogWithGold(ctx, records);
  assert.equal(catalogById.get("chaos").goldPerUnit, 4242);
  assert.equal(catalogById.get("chaos").status, "supported");
  const committedDivine = POE2_GOLD_COSTS.find((record) => record.itemId === "divine");
  assert.equal(catalogById.get("divine").goldPerUnit, committedDivine.goldPerUnit);
});

test("gold loader: a row with no usable number is dropped rather than ranking a NaN", async () => {
  resetGoldOverridesCache();
  const entry = await readGoldOverridesCached("poe2", {
    config: CONFIG,
    trace: silent,
    now: NOW,
    makeRepo: goldRepo([goldRow({ itemKey: "chaos", goldPerUnit: null }), goldRow({ itemKey: "divine", goldPerUnit: Number.NaN })]),
  });
  assert.deepEqual([entry.records, entry.rows], [[], 0]);
});

test("gold loader: a missing table is a traced, expected, empty result", async () => {
  resetGoldOverridesCache();
  const traced = [];
  const error = Object.assign(new Error('relation "gold_costs" does not exist'), { code: "42P01" });
  const entry = await readGoldOverridesCached("poe2", {
    config: CONFIG, trace: (phase) => traced.push(phase), now: NOW, makeRepo: goldRepo([], { error }),
  });
  assert.deepEqual(traced, ["gold-costs.table-missing"]);
  assert.deepEqual([entry.records, entry.rows, entry.fetchedAt], [[], 0, null]);
});

test("gold loader: concurrent cold requests issue ONE read", async () => {
  resetGoldOverridesCache();
  let reads = 0;
  const options = {
    config: CONFIG, trace: silent, now: NOW,
    makeRepo: goldRepo([goldRow()], { onRead: () => { reads += 1; } }),
  };
  const results = await Promise.all(Array.from({ length: 8 }, () => loadGoldOverrides("poe2", options)));
  assert.equal(reads, 1);
  for (const result of results) assert.equal(result, results[0]);
});

test("no gold overrides means the warm-instance manifest is reused by identity, not rebuilt", () => {
  const ctx = {
    config: CONFIG,
    catalog: { items: [{ id: "chaos", name: "Chaos Orb", category: "Currency" }] },
    goldPlaceholder: false,
    catalogManifest: [{ id: "chaos" }],
    catalogById: new Map([["chaos", { id: "chaos" }]]),
  };
  const empty = catalogWithGold(ctx, []);
  assert.equal(empty.catalogManifest, ctx.catalogManifest);
  assert.equal(empty.catalogById, ctx.catalogById);

  // A demo flat registry must never be "improved" with real stored gold.
  const placeholder = catalogWithGold({ ...ctx, goldPlaceholder: true }, [
    { game: "poe2", itemId: "chaos", goldPerUnit: 1 },
  ]);
  assert.equal(placeholder.catalogManifest, ctx.catalogManifest);
});

test("the merged manifest is built once per loader TTL, not once per request", () => {
  const ctx = {
    config: CONFIG,
    catalog: { items: [{ id: "chaos", name: "Chaos Orb", category: "Currency" }] },
    goldPlaceholder: false,
    catalogManifest: [{ id: "chaos" }],
    catalogById: new Map(),
  };
  const records = [{ game: "poe2", itemId: "chaos", goldPerUnit: 7 }];
  assert.equal(catalogWithGold(ctx, records), catalogWithGold(ctx, records));
});
