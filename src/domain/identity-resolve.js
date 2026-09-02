/**
 * ONE implementation of "GGG Metadata id -> display identity".
 *
 * This used to live twice: once in scripts/build-identity.mjs (PoE2) and once in
 * scripts/build-identity-poe1.mjs, each fetching RePoE `base_items` plus a trade
 * catalog and folding them into `src/data/cx-identity-*.json`. Phase B adds a
 * THIRD caller — the runtime job that resolves ids the committed snapshot has
 * never heard of (apps/web/lib/identity-refresh.js) — and three copies of a
 * name-join with collision handling would drift within a league.
 *
 * So the join is here, pure and synchronous: no fetch, no filesystem, no clock.
 * Callers supply the two already-fetched documents; this decides names, art,
 * icons, short ids and the trade category. The scripts keep their own I/O,
 * output envelope and logging, so the committed JSON stays byte-identical.
 *
 * The two games differ in exactly two ways, expressed as options rather than as
 * a second code path:
 *   - PoE2 owns short ids by joining RePoE names to the trade catalog (names are
 *     unique per item, art paths are not); PoE1 has no such catalog join and
 *     pins only the three core currencies by hand.
 *   - PoE2 attaches the catalog's official hashed image URL as `icon`; PoE1
 *     carries no `icon` key at all and lets the runtime derive a CDN URL from
 *     `art`.
 */

import { chooseShortIdOwner } from "./identity-collision.js";
import { buildIdentityTaxonomy } from "./identity-taxonomy.js";
import { humanize } from "./humanize.js";

/**
 * Join key: exact display name, case/space-normalized. Names are unique per item
 * (tiers included: "Exalted Orb" vs "Greater Exalted Orb"), so joining on name —
 * NOT on the shared 2D art path — avoids attaching a base item's icon/short-id
 * to its Greater/Perfect variants.
 */
export const nameKey = (name) => String(name).trim().toLowerCase().replace(/\s+/g, " ");

/** RePoE visual_identity.dds_file "Art/2DItems/.../X.dds" -> "2DItems/.../X". */
export function artFromDds(dds) {
  if (typeof dds !== "string") return null;
  return dds.replace(/^Art\//, "").replace(/\.dds$/i, "");
}

/** Catalog display name -> { image, id }. First wins on the rare duplicate name. */
export function catalogIndexByName(catalogItems = []) {
  const byName = new Map();
  for (const item of catalogItems ?? []) {
    if (item?.name == null) continue;
    const key = nameKey(item.name);
    if (key && !byName.has(key)) byName.set(key, { image: item.image, id: item.id });
  }
  return byName;
}

/**
 * Decide which Metadata id owns each trade short id.
 *
 * Names are NOT unique across Metadata ids (quest/bench/legacy copies), so the
 * live exchange settles it rather than RePoE's key order — see
 * src/domain/identity-collision.js.
 *
 * @returns {{ shortIdOwner: Map<string,string>, contested: number }}
 */
export function assignShortIds({ baseItems = {}, catalogByName = new Map(), tradedIds = new Set() } = {}) {
  const byName = new Map();
  for (const [metaId, entry] of Object.entries(baseItems)) {
    if (!entry?.name) continue;
    const key = nameKey(entry.name);
    if (!catalogByName.has(key)) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(metaId);
  }
  const shortIdOwner = new Map();
  let contested = 0;
  for (const [key, metaIds] of byName) {
    const owner = chooseShortIdOwner(metaIds, tradedIds);
    if (owner) shortIdOwner.set(owner, catalogByName.get(key).id);
    if (metaIds.length > 1) contested += 1;
  }
  return { shortIdOwner, contested };
}

/**
 * Fold RePoE base items + a trade catalog into the identity map.
 *
 * Insertion order is load-bearing for the build scripts (it decides the byte
 * order of the committed JSON): RePoE's own key order for named base items,
 * then any observed id RePoE has never heard of, in observation order.
 *
 * @param {{
 *   baseItems?: Record<string, any>,   // RePoE base_items(.min).json
 *   catalogItems?: Array<{ id: string, name: string, category?: string, image?: string }>,
 *   observedIds?: Set<string>|Iterable<string>, // ids seen on the live exchange
 *   coreShortIds?: Record<string, string>,      // hand-pinned metaId -> shortId
 *   joinShortIdsByName?: boolean,      // PoE2: own short ids via the catalog join
 *   attachCatalogIcon?: boolean,       // PoE2: carry the catalog's image URL
 * }} options
 * @returns {{ items: Record<string, object>, stats: object }}
 */
export function buildIdentityEntries({
  baseItems = {},
  catalogItems = [],
  observedIds = new Set(),
  coreShortIds = {},
  joinShortIdsByName = false,
  attachCatalogIcon = false,
} = {}) {
  const observed = observedIds instanceof Set ? observedIds : new Set(observedIds ?? []);
  const catalogByName = catalogIndexByName(catalogItems);
  const { shortIdOwner, contested } = joinShortIdsByName
    ? assignShortIds({ baseItems, catalogByName, tradedIds: observed })
    : { shortIdOwner: new Map(), contested: 0 };

  const identityEntries = Object.fromEntries(Object.entries(baseItems)
    .filter(([, entry]) => entry?.name)
    .map(([metaId, entry]) => [metaId, {
      name: entry.name,
      class: entry.item_class ?? null,
      art: artFromDds(entry.visual_identity?.dds_file),
      shortId: shortIdOwner.get(metaId) ?? coreShortIds[metaId] ?? null,
    }]));
  // An id the exchange lists but RePoE has never heard of still deserves a real
  // row: a humanized leaf beats a raw Metadata path in the UI.
  for (const metaId of observed) {
    if (!identityEntries[metaId]) {
      identityEntries[metaId] = {
        name: humanize(metaId),
        class: null,
        art: null,
        shortId: coreShortIds[metaId] ?? null,
      };
    }
  }

  const resolveTaxonomy = buildIdentityTaxonomy({ catalogItems, identities: identityEntries, observedIds: observed });

  const items = {};
  let named = 0;
  let iconed = 0;
  let withArt = 0;
  const taxonomyCounts = {};
  for (const [metaId, entry] of Object.entries(identityEntries)) {
    const cat = catalogByName.get(nameKey(entry.name));
    const taxonomy = resolveTaxonomy(metaId, entry);
    items[metaId] = {
      ...entry,
      ...(attachCatalogIcon ? { icon: cat?.image ?? null } : {}),
      ...taxonomy,
    };
    taxonomyCounts[taxonomy.taxonomySource] = (taxonomyCounts[taxonomy.taxonomySource] ?? 0) + 1;
    named += 1;
    if (cat?.image) iconed += 1;
    if (entry.art) withArt += 1;
  }

  return { items, stats: { named, iconed, withArt, contested, taxonomyCounts } };
}
