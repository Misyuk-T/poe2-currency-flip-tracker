import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const LAYOUT_URLS = Object.freeze({
  poe1: () => new URL("../data/exchange-layout-poe1.json", import.meta.url),
  poe2: () => new URL("../data/exchange-layout-poe2.json", import.meta.url),
});

const stores = new Map();

function normalizeGame(game) {
  return game === "poe1" ? "poe1" : "poe2";
}

export function normalizeExchangeName(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[‘’‛`´]/g, "'")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function load(game = "poe2") {
  const resolvedGame = normalizeGame(game);
  const cached = stores.get(resolvedGame);
  if (cached) return cached;

  let snapshot = { categories: [], items: [] };
  try {
    snapshot = JSON.parse(readFileSync(fileURLToPath(LAYOUT_URLS[resolvedGame]().href), "utf8"));
  } catch {
    // An unavailable snapshot must degrade visibly, never silently reuse the
    // technical trade class as though it were an in-game category.
  }

  const byMetadata = new Map();
  const byName = new Map();
  for (const item of snapshot.items ?? []) {
    if (item.metadataId) byMetadata.set(item.metadataId, item);
    const key = item.normalizedName || normalizeExchangeName(item.name);
    const previous = byName.get(key);
    if (!previous || (previous.category === item.category && previous.section === item.section)) {
      byName.set(key, item);
    } else {
      byName.delete(key);
    }
  }
  const store = { snapshot, byMetadata, byName };
  stores.set(resolvedGame, store);
  return store;
}

function metadataCandidates(row) {
  return [row?.target, row?.id, row?.metadataId]
    .filter((value) => typeof value === "string" && value.startsWith("Metadata/Items/"));
}

export function resolveExchangeLayout(row, game = "poe2") {
  const { byMetadata, byName } = load(game);
  let match = null;
  for (const id of metadataCandidates(row)) {
    match = byMetadata.get(id);
    if (match) break;
  }
  match ??= byName.get(normalizeExchangeName(row?.targetName ?? row?.name ?? row?.target));

  const tradeCategory = row?.tradeCategory ?? row?.category ?? null;
  const tradeSubcategory = row?.tradeSubcategory ?? row?.subcategory ?? null;
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

export function applyExchangeLayout(rows, game = "poe2") {
  return (rows ?? []).map((row) => resolveExchangeLayout(row, game));
}

export function exchangeLayoutCategories(game = "poe2") {
  return (load(game).snapshot.categories ?? []).map((category) => ({
    name: category.name,
    order: category.order,
    sections: category.sections.map((section) => ({ ...section })),
  }));
}
