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

// Resolved inside load(), not at module scope. Next's bundled page runtime
// gives `import.meta.url` a value the URL constructor rejects outright
// (ERR_INVALID_URL), so doing this eagerly meant merely *importing* this module
// threw there — and the failure surfaced far from here, as pages that silently
// lost their data. Behind the read's own try/catch, the same environment now
// degrades to an empty map instead.
const IDENTITY_FILES = Object.freeze({
  poe1: "../data/cx-identity-poe1.json",
  poe2: "../data/cx-identity-poe2.json",
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
    const path = fileURLToPath(new URL(IDENTITY_FILES[resolvedGame], import.meta.url).href);
    items = JSON.parse(readFileSync(path, "utf8")).items ?? {};
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
