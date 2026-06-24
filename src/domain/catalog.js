/**
 * PoE2 item catalog: stable trade ids + display names + categories, sourced from
 * GGG `api/trade2/data/static` (committed as metadata in data/catalog-poe2.json;
 * facts, not art). Merged with the gold registry to derive a per-item status:
 *   - "supported"          : a verified gold cost exists (rankable in any mode)
 *   - "unknown-gold-cost"  : tradeable, but no verified gold cost (UNRANKABLE in
 *                            strict gold mode; rankable by ROI in show/ignore)
 *
 * Icon ART is GGG-owned and is NOT committed. `scripts/build-catalog.mjs`
 * downloads it locally into src/public/icons/ (gitignored); the UI falls back to
 * a neutral glyph when an icon hasn't been downloaded.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { catalogTaxonomy } from "./catalog-taxonomy.js";

const CATALOG_PATH = fileURLToPath(new URL("../data/catalog-poe2.json", import.meta.url));

/** @returns {Promise<{game:string, items:{id:string,name:string,category:string,image:string|null}[]}>} */
export async function loadCatalog() {
  try {
    return JSON.parse(await readFile(CATALOG_PATH, "utf8"));
  } catch {
    return { game: "poe2", items: [] };
  }
}

/**
 * Manifest entry per catalog item, with gold coverage status. `image` (the
 * remote GGG art URL) is intentionally omitted from the API surface.
 */
export function buildManifest(catalog, goldRegistry) {
  return (catalog.items ?? []).map((it) => {
    const hasGold = goldRegistry.has?.(it.id) ?? false;
    const taxonomy = catalogTaxonomy(it);
    return {
      id: it.id,
      name: it.name,
      category: it.category,
      subcategory: taxonomy.subcategory,
      catalogOrder: taxonomy.catalogOrder,
      icon: `icons/${it.id}.png`, // local path; UI falls back if not downloaded
      goldPerUnit: hasGold ? goldRegistry.goldPerUnit(it.id) : null,
      status: hasGold ? "supported" : "unknown-gold-cost",
    };
  });
}

/** id -> display name, for labelling targets the gold table doesn't cover. */
export function nameMapFromCatalog(catalog) {
  const m = {};
  for (const it of catalog.items ?? []) m[it.id] = it.name;
  return m;
}
