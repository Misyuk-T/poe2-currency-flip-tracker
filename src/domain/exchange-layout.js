/**
 * In-game Currency Exchange layout: which category and section a radar row sits
 * in, and in what order.
 *
 * Two sources, in strict precedence:
 *   1. `exchange_layout` rows (migration 011), refreshed daily by
 *      apps/web/lib/data-refresh.js. Passed in by the caller as `overrides` —
 *      this module never touches a database.
 *   2. the committed `src/data/exchange-layout-*.json` snapshot, rebuilt by
 *      `npm run layout:build` and merged by a PR.
 *
 * The merge is per ITEM and per FIELD: a stored row replaces the committed item
 * with the same key, but a null column in that row leaves the committed value
 * standing, and an item the database has never seen still resolves from the
 * snapshot. A missing or empty override set is not a downgrade — it is exactly
 * the behaviour this file had before Phase C.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { exchangeLayoutItemKey, normalizeExchangeName } from "./exchange-layout-parse.js";

// Re-exported rather than reimplemented: the key an override is matched by is
// derived from this function, so a second copy here would be a silent way for
// the stored rows and the committed snapshot to stop agreeing about what "the
// same item" means.
export { normalizeExchangeName };

const LAYOUT_URLS = Object.freeze({
  poe1: () => new URL("../data/exchange-layout-poe1.json", import.meta.url),
  poe2: () => new URL("../data/exchange-layout-poe2.json", import.meta.url),
});

const snapshots = new Map();
const stores = new Map();

function normalizeGame(game) {
  return game === "poe1" ? "poe1" : "poe2";
}

/**
 * The committed snapshot for one game, parsed once per process.
 *
 * Exported because the refresh job derives its coverage floor from it (">= 80%
 * of what the shipped file knows") and seeds a first-run comparison from it.
 */
export function committedExchangeLayout(game = "poe2") {
  const resolvedGame = normalizeGame(game);
  const cached = snapshots.get(resolvedGame);
  if (cached) return cached;

  let snapshot = { categories: [], items: [] };
  try {
    snapshot = JSON.parse(readFileSync(fileURLToPath(LAYOUT_URLS[resolvedGame]().href), "utf8"));
  } catch {
    // An unavailable snapshot must degrade visibly, never silently reuse the
    // technical trade class as though it were an in-game category.
  }
  snapshots.set(resolvedGame, snapshot);
  return snapshot;
}

/**
 * Category/section tree implied by a list of items.
 *
 * The parser already compacts categories down to those that own items and
 * renumbers them, so this reproduces the committed `categories` array exactly
 * for both games (asserted in test/exchange-layout-parse.test.js). That is why
 * migration 011 stores items only and no second table.
 */
export function categoriesFromItems(items) {
  const byCategory = new Map();
  for (const item of items ?? []) {
    if (item?.category == null) continue;
    if (!byCategory.has(item.category)) {
      byCategory.set(item.category, { name: item.category, order: item.categoryOrder, sections: new Map() });
    }
    const category = byCategory.get(item.category);
    if (item.section == null || category.sections.has(item.section)) continue;
    category.sections.set(item.section, { name: item.section, order: item.sectionOrder });
  }
  return [...byCategory.values()]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((category) => ({
      name: category.name,
      order: category.order,
      sections: [...category.sections.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    }));
}

const FIELDS = [
  "name",
  "normalizedName",
  "metadataId",
  "href",
  "category",
  "section",
  "categoryOrder",
  "sectionOrder",
  "itemOrder",
];

/**
 * Committed items, with stored rows layered on top.
 *
 * Per item (keyed by {@link exchangeLayoutItemKey}) and per field: a stored
 * value wins, a null or absent stored value keeps the committed one, and a
 * stored row for an item the snapshot has never heard of is appended. Nothing
 * is ever removed — a row the upstream page dropped keeps ordering an item that
 * has stopped trading rather than blanking one that has not.
 */
export function mergeExchangeLayoutItems(committedItems, overrideItems) {
  if (!overrideItems?.length) return committedItems ?? [];
  const byKey = new Map();
  for (const item of overrideItems) {
    const key = exchangeLayoutItemKey(item);
    if (key) byKey.set(key, item);
  }
  const merged = [];
  const used = new Set();
  for (const item of committedItems ?? []) {
    const key = exchangeLayoutItemKey(item);
    const override = key ? byKey.get(key) : null;
    if (!override) {
      merged.push(item);
      continue;
    }
    used.add(key);
    const next = { ...item };
    for (const field of FIELDS) if (override[field] != null) next[field] = override[field];
    merged.push(next);
  }
  for (const [key, item] of byKey) {
    if (used.has(key)) continue;
    merged.push({ ...item, normalizedName: item.normalizedName || normalizeExchangeName(item.name) });
  }
  return merged;
}

function buildStore(snapshot, items, categories) {
  const byMetadata = new Map();
  const byName = new Map();
  const bySectionName = new Map();
  for (const item of items ?? []) {
    if (item.metadataId) byMetadata.set(item.metadataId, item);
    const key = item.normalizedName || normalizeExchangeName(item.name);
    const previous = byName.get(key);
    if (!previous || (previous.category === item.category && previous.section === item.section)) {
      byName.set(key, item);
    } else {
      byName.delete(key);
    }
  }
  for (const category of categories ?? []) {
    for (const section of category.sections ?? []) {
      const key = normalizeExchangeName(section.name);
      const candidate = {
        category: category.name,
        section: section.name,
        categoryOrder: category.order,
        sectionOrder: section.order,
      };
      bySectionName.set(key, bySectionName.has(key) ? null : candidate);
    }
  }
  return { snapshot, categories, byMetadata, byName, bySectionName };
}

function committedStore(game) {
  const resolvedGame = normalizeGame(game);
  const cached = stores.get(resolvedGame);
  if (cached) return cached;
  const snapshot = committedExchangeLayout(resolvedGame);
  const store = buildStore(snapshot, snapshot.items ?? [], snapshot.categories ?? []);
  stores.set(resolvedGame, store);
  return store;
}

/**
 * Merged stores are memoized against the OVERRIDES ARRAY ITSELF, exactly like
 * radar-backend's identity merge: the loader hands out the same array object for
 * its whole 10-minute TTL, so the merge and the three index maps are rebuilt
 * once per TTL rather than once per request over ~700-1100 items.
 */
const mergedStoreCache = new WeakMap();

function storeFor(game, overrides) {
  const base = committedStore(game);
  if (!overrides?.length) return base;
  const cached = mergedStoreCache.get(overrides);
  if (cached?.base === base) return cached.store;
  const items = mergeExchangeLayoutItems(base.snapshot.items ?? [], overrides);
  const store = buildStore(base.snapshot, items, categoriesFromItems(items));
  mergedStoreCache.set(overrides, { base, store });
  return store;
}

function metadataCandidates(row) {
  return [row?.target, row?.id, row?.metadataId]
    .filter((value) => typeof value === "string" && value.startsWith("Metadata/Items/"));
}

function resolveWithStore(row, { byMetadata, byName, bySectionName }) {
  let match = null;
  for (const id of metadataCandidates(row)) {
    match = byMetadata.get(id);
    if (match) break;
  }
  match ??= byName.get(normalizeExchangeName(row?.targetName ?? row?.name ?? row?.target));

  const tradeCategory = row?.tradeCategory ?? row?.category ?? null;
  const tradeSubcategory = row?.tradeSubcategory ?? row?.subcategory ?? null;
  if (!match) {
    const inferred = [tradeSubcategory, tradeCategory]
      .map(normalizeExchangeName)
      .map((key) => bySectionName.get(key))
      .find(Boolean);
    if (inferred) {
      return {
        ...row,
        tradeCategory,
        tradeSubcategory,
        category: inferred.category,
        subcategory: inferred.section,
        categoryOrder: inferred.categoryOrder,
        sectionOrder: inferred.sectionOrder,
        itemOrder: Number.MAX_SAFE_INTEGER,
        layoutSource: "game-client-section-inference",
      };
    }
  }
  if (!match) {
    return {
      ...row,
      tradeCategory,
      tradeSubcategory,
      category: "Needs classification",
      subcategory: "Needs classification",
      categoryOrder: Number.MAX_SAFE_INTEGER,
      sectionOrder: Number.MAX_SAFE_INTEGER,
      itemOrder: Number.MAX_SAFE_INTEGER,
      layoutSource: "unmapped-exchange-item",
    };
  }

  return {
    ...row,
    tradeCategory,
    tradeSubcategory,
    category: match.category,
    subcategory: match.section,
    categoryOrder: match.categoryOrder,
    sectionOrder: match.sectionOrder,
    itemOrder: match.itemOrder,
    layoutSource: "game-client-layout",
  };
}

export function resolveExchangeLayout(row, game = "poe2", { overrides = null } = {}) {
  return resolveWithStore(row, storeFor(game, overrides));
}

/**
 * The store is resolved ONCE for the whole batch, not once per row: the merge is
 * memoized, but paying even a WeakMap lookup per row over a full catalog buys
 * nothing.
 */
export function applyExchangeLayout(rows, game = "poe2", { overrides = null } = {}) {
  const store = storeFor(game, overrides);
  return (rows ?? []).map((row) => resolveWithStore(row, store));
}

export function exchangeLayoutCategories(game = "poe2", { overrides = null } = {}) {
  return (storeFor(game, overrides).categories ?? []).map((category) => ({
    name: category.name,
    order: category.order,
    sections: category.sections.map((section) => ({ ...section })),
  }));
}
