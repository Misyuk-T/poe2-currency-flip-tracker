/**
 * Currency Exchange identity: resolve a live CX Metadata id
 * (Metadata/Items/<Class>/<Leaf>) to display info { id, name, icon, shortId,
 * category }.
 *
 * Names come from RePoE (GGPK-derived; see scripts/build-identity.mjs),
 * icons/short-ids are joined from our catalog for the currency core. Anything the
 * map doesn't cover falls back to a humanized leaf so the radar never shows a raw
 * Metadata path. The canonical id stays the Metadata path (complete + stable);
 * this layer is display + the short-id bridge, not identity.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { humanize } from "./humanize.js";

export { humanize };

// Two constraints pull in opposite directions here.
//
// The specifier must stay a LITERAL inside `new URL(..., import.meta.url)`:
// that exact shape is what a bundler recognises as an asset reference and
// rewrites to wherever it emitted the file. Build it from a variable and the
// analysis silently fails, the path resolves to nothing, and every name and
// icon in the radar quietly disappears.
//
// It also must not run at module scope: in Next's bundled page runtime
// `import.meta.url` is not a URL the constructor accepts (ERR_INVALID_URL), so
// evaluating it eagerly made merely *importing* this module throw, which took
// down the data on pages that only wanted a string helper.
//
// A thunk satisfies both — literal for the bundler, deferred to the read, where
// the existing try/catch degrades to an empty map.
const IDENTITY_URLS = Object.freeze({
  poe1: () => new URL("../data/cx-identity-poe1.json", import.meta.url),
  poe2: () => new URL("../data/cx-identity-poe2.json", import.meta.url),
});

const stores = new Map();

function normalizeGame(game) {
  return game === "poe1" ? "poe1" : "poe2";
}

function load(game = "poe2") {
  const resolvedGame = normalizeGame(game);
  const cached = stores.get(resolvedGame);
  if (cached) return cached;
  let items;
  try {
    items = JSON.parse(readFileSync(fileURLToPath(IDENTITY_URLS[resolvedGame]().href), "utf8")).items ?? {};
  } catch {
    items = {};
  }
  const shortToMeta = new Map();
  for (const [meta, e] of Object.entries(items)) {
    // shortIds are unique per item in the built map (name-join + owner dedup in
    // build-identity.mjs), so this is an unambiguous 1:1 reverse bridge that does
    // not depend on iteration/serialization order.
    if (e.shortId) shortToMeta.set(e.shortId, meta);
  }
  const store = { game: resolvedGame, items, shortToMeta };
  stores.set(resolvedGame, store);
  return store;
}

/** Convert a RePoE visual identity into an official GGG CDN URL. */
function iconFromArt(art, game) {
  if (typeof art !== "string" || !art) return null;
  const clean = art.replace(/^Art\//, "").replace(/\.dds$/i, "");
  const path = clean.split("/").map(encodeURIComponent).join("/");
  const realm = normalizeGame(game) === "poe2" ? "&realm=poe2" : "";
  return `https://web.poecdn.com/image/Art/${path}.png?scale=1${realm}`;
}

/** Resolve a Metadata id to display info; humanized fallback when unmapped. */
export function resolveCurrency(metadataId, game = "poe2") {
  const { items } = load(game);
  const e = items[metadataId];
  if (e) {
    return {
      id: metadataId,
      name: e.name,
      icon: e.icon ?? iconFromArt(e.art, game),
      shortId: e.shortId ?? null,
      category: e.class ? humanize(e.class) : null,
    };
  }
  return { id: metadataId, name: humanize(metadataId), icon: null, shortId: null, category: null };
}

/** Metadata id for a trade short id (e.g. "exalted" -> the Exalted Orb path). */
export function metadataForShortId(shortId, game = "poe2") {
  const { shortToMeta } = load(game);
  return shortToMeta.get(shortId) ?? null;
}

/** True when the id is covered by the map (not just a humanized fallback). */
export function isKnownCurrency(metadataId, game = "poe2") {
  const { items } = load(game);
  return Object.prototype.hasOwnProperty.call(items, metadataId);
}

/** { metadataId: name } for every mapped item — merge into the radar `names` map
 *  so tail targets (Metadata ids without a catalog short id) still render a real
 *  name instead of a raw path. */
export function identityNames(game = "poe2") {
  const { items } = load(game);
  const out = {};
  for (const [meta, e] of Object.entries(items)) {
    out[meta] = e.name;
    if (e.shortId) out[e.shortId] = e.name;
  }
  return out;
}

/** { canonical-or-Metadata id: official GGG CDN image URL }. */
export function identityIcons(game = "poe2") {
  const { items } = load(game);
  const out = {};
  for (const [meta, e] of Object.entries(items)) {
    const icon = e.icon ?? iconFromArt(e.art, game);
    if (!icon) continue;
    out[meta] = icon;
    if (e.shortId) out[e.shortId] = icon;
  }
  return out;
}

/** { canonical-or-Metadata id: RePoE item class }. */
export function identityCategories(game = "poe2") {
  const { items } = load(game);
  const out = {};
  for (const [meta, e] of Object.entries(items)) {
    if (!e.class) continue;
    const category = humanize(e.class);
    out[meta] = category;
    if (e.shortId) out[e.shortId] = category;
  }
  return out;
}
