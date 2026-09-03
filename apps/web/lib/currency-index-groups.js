/**
 * Pure: arrange the currency ids that have market data into the in-game
 * Currency Exchange tree (category -> section -> item), so the /poe2/currencies
 * index can render ~630 crawlable links that read like the trade screen instead
 * of one alphabetical wall.
 *
 * TWO SOURCES, same precedence as src/domain/exchange-layout.js: the
 * `exchange_layout` rows (migration 011, refreshed daily by our own cron) are
 * layered over the committed `src/data/exchange-layout-poe2.json` snapshot, per
 * item and per field, by that module's own `mergeExchangeLayoutItems`. Callers
 * pass the rows in; this module never touches a database.
 *
 * Reading the stored rows HERE is not a re-litigation of the Phase C
 * "cron-only" decision. That decision is about /api/radar's rebuild path, which
 * is a hot request path. This page is ISR with `revalidate = 3600`: one bounded
 * read per regeneration, not per request. And it is load-bearing for exactly
 * one week a year — a new league's items land in the table the next day but in
 * the committed JSON only on a monthly PR, so without the stored rows every
 * brand-new market would sit in "Other markets" for days, during the precise
 * week it is most searched.
 *
 * The snapshot is a STATIC import, not the resolver's `readFileSync`:
 * next.config.mjs traces those JSONs into the `/api/**` function bundles only,
 * a page bundle gets no such entry, and the file tracer does not follow the
 * `fileURLToPath(new URL(...))` read on its own. A static import is bundled by
 * webpack, so it cannot go missing at runtime. The matching and merge rules are
 * imported from the shared modules rather than reimplemented: a second copy of
 * "what is the same item" is how the page and the radar quietly stop agreeing.
 */

import layout from "../../../src/data/exchange-layout-poe2.json" with { type: "json" };
import { normalizeExchangeName } from "../../../src/domain/exchange-layout-parse.js";
import { mergeExchangeLayoutItems } from "../../../src/domain/exchange-layout.js";

/**
 * Trailing bucket for a currency neither source can place. With the stored rows
 * available this is normally empty; it exists so an unknown item is still
 * LINKED rather than dropped — being unmapped is our gap, not the market's.
 */
export const UNMAPPED_CATEGORY = "Other markets";
const UNMAPPED_ORDER = Number.MAX_SAFE_INTEGER;

const METADATA_PREFIX = "Metadata/Items/";

function buildIndex(items) {
  const byMetadata = new Map();
  const byName = new Map();
  for (const item of items ?? []) {
    if (item?.metadataId) byMetadata.set(item.metadataId, item);
    const key = item?.normalizedName || normalizeExchangeName(item?.name);
    if (!key) continue;
    // Mirrors `buildStore`'s byName rule in src/domain/exchange-layout.js: when
    // two items share a normalised name but sit in different places, the name
    // stops identifying anything and the entry is dropped rather than filed
    // under a coin flip. The metadata id above is unambiguous and unaffected.
    if (!byName.has(key)) {
      byName.set(key, item);
      continue;
    }
    const previous = byName.get(key);
    if (previous && previous.category === item.category && previous.section === item.section) continue;
    byName.set(key, null);
  }
  return { byMetadata, byName };
}

const committedIndex = buildIndex(layout.items ?? []);

/**
 * Memoized against the OVERRIDES ARRAY ITSELF, exactly like the domain module:
 * `loadLayoutOverrides` hands out the same array object for its whole TTL, so
 * the merge and the two index maps are rebuilt once per TTL rather than once
 * per render over ~700 items.
 */
const mergedCache = new WeakMap();

function indexFor(overrides) {
  if (!overrides?.length) return committedIndex;
  const cached = mergedCache.get(overrides);
  if (cached) return cached;
  const built = buildIndex(mergeExchangeLayoutItems(layout.items ?? [], overrides));
  mergedCache.set(overrides, built);
  return built;
}

export function slugifyGroupName(name) {
  const slug = normalizeExchangeName(name).replace(/\s+/g, "-");
  return slug || "group";
}

const UNMAPPED_PLACEMENT = Object.freeze({
  category: UNMAPPED_CATEGORY,
  section: UNMAPPED_CATEGORY,
  categoryOrder: UNMAPPED_ORDER,
  sectionOrder: UNMAPPED_ORDER,
  itemOrder: UNMAPPED_ORDER,
  mapped: false,
});

/**
 * Metadata id FIRST, then normalised name — the same order
 * `resolveWithStore` uses. Eight live ids ARE raw metadata paths (the identity
 * build has no short id for them yet); they have no display name the snapshot
 * would recognise, and only the metadata lookup places them.
 */
function placementFor(entry, index) {
  const candidates = [entry?.metadataId, entry?.id].filter(
    (value) => typeof value === "string" && value.startsWith(METADATA_PREFIX),
  );
  let match = null;
  for (const candidate of candidates) {
    match = index.byMetadata.get(candidate);
    if (match) break;
  }
  match ??= index.byName.get(normalizeExchangeName(entry?.name ?? entry?.id));
  if (!match) return UNMAPPED_PLACEMENT;

  return {
    category: match.category ?? UNMAPPED_CATEGORY,
    section: match.section ?? match.category ?? UNMAPPED_CATEGORY,
    categoryOrder: Number.isFinite(match.categoryOrder) ? match.categoryOrder : UNMAPPED_ORDER,
    sectionOrder: Number.isFinite(match.sectionOrder) ? match.sectionOrder : UNMAPPED_ORDER,
    itemOrder: Number.isFinite(match.itemOrder) ? match.itemOrder : UNMAPPED_ORDER,
    mapped: true,
  };
}

/**
 * The exchange placement of one currency. Never null: an unplaceable item comes
 * back as {@link UNMAPPED_CATEGORY} with `mapped: false`, which is the caller's
 * signal not to link a group anchor that would not exist on the index page.
 */
export function exchangePlacement(name, { id = null, metadataId = null, overrides = null } = {}) {
  return placementFor({ name, id, metadataId }, indexFor(overrides));
}

function compare(a, b) {
  return a.order - b.order || a.name.localeCompare(b.name);
}

/**
 * Group `entries` ({ id, name, ...rest }) into the exchange tree.
 *
 * Returns `{ categories, total }` where each category is
 * `{ name, slug, order, count, sections: [{ name, slug, order, rows }] }` and a
 * row is the original entry plus its `itemOrder`. Ordering is the game's:
 * category order, then section order, then the item's own position in the
 * section, with a name tiebreak so the output is deterministic.
 *
 * Pure — no clock, no I/O, no formatting decisions. `overrides` is the stored
 * `exchange_layout` row list (or null/empty for the committed snapshot alone).
 */
export function groupCurrenciesByExchangeLayout(entries, { overrides = null } = {}) {
  const index = indexFor(overrides);
  const categories = new Map();
  let total = 0;

  for (const entry of entries ?? []) {
    if (!entry?.id) continue;
    const name = entry.name ?? entry.id;
    const placement = placementFor({ ...entry, name }, index);
    total += 1;

    let category = categories.get(placement.category);
    if (!category) {
      category = {
        name: placement.category,
        slug: slugifyGroupName(placement.category),
        order: placement.categoryOrder,
        count: 0,
        sections: new Map(),
      };
      categories.set(placement.category, category);
    }
    category.count += 1;
    // A stored row can move an item into a category the snapshot ordered
    // differently; keep the smallest order seen so a category cannot drift to
    // the end because one late member arrived unranked.
    category.order = Math.min(category.order, placement.categoryOrder);

    let section = category.sections.get(placement.section);
    if (!section) {
      section = {
        name: placement.section,
        slug: slugifyGroupName(placement.section),
        order: placement.sectionOrder,
        rows: [],
      };
      category.sections.set(placement.section, section);
    }
    section.order = Math.min(section.order, placement.sectionOrder);
    section.rows.push({ ...entry, name, itemOrder: placement.itemOrder });
  }

  const ordered = [...categories.values()].sort(compare).map((category) => ({
    name: category.name,
    slug: category.slug,
    order: category.order,
    count: category.count,
    sections: [...category.sections.values()].sort(compare).map((section) => ({
      name: section.name,
      slug: section.slug,
      order: section.order,
      rows: section.rows.sort((a, b) => a.itemOrder - b.itemOrder || a.name.localeCompare(b.name)),
    })),
  }));

  return { categories: ordered, total };
}
