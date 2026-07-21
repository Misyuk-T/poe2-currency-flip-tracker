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

const IDENTITY_PATH = fileURLToPath(new URL("../data/cx-identity-poe2.json", import.meta.url));

let items = null;
let shortToMeta = null;

function load() {
  if (items) return;
  try {
    items = JSON.parse(readFileSync(IDENTITY_PATH, "utf8")).items ?? {};
  } catch {
    items = {};
  }
  shortToMeta = new Map();
  for (const [meta, e] of Object.entries(items)) {
    // shortIds are unique per item in the built map (name-join + owner dedup in
    // build-identity.mjs), so this is an unambiguous 1:1 reverse bridge that does
    // not depend on iteration/serialization order.
    if (e.shortId) shortToMeta.set(e.shortId, meta);
  }
}

/** Resolve a Metadata id to display info; humanized fallback when unmapped. */
export function resolveCurrency(metadataId) {
  load();
  const e = items[metadataId];
  if (e) {
    return {
      id: metadataId,
      name: e.name,
      icon: e.icon ?? null,
      shortId: e.shortId ?? null,
      category: e.class ?? null,
    };
  }
  return { id: metadataId, name: humanize(metadataId), icon: null, shortId: null, category: null };
}

/** Metadata id for a trade short id (e.g. "exalted" -> the Exalted Orb path). */
export function metadataForShortId(shortId) {
  load();
  return shortToMeta.get(shortId) ?? null;
}

/** True when the id is covered by the map (not just a humanized fallback). */
export function isKnownCurrency(metadataId) {
  load();
  return Object.prototype.hasOwnProperty.call(items, metadataId);
}

/** { metadataId: name } for every mapped item — merge into the radar `names` map
 *  so tail targets (Metadata ids without a catalog short id) still render a real
 *  name instead of a raw path. */
export function identityNames() {
  load();
  const out = {};
  for (const [meta, e] of Object.entries(items)) out[meta] = e.name;
  return out;
}

/** "Metadata/Items/Currency/CurrencyRerollRare" -> "Currency Reroll Rare". */
export function humanize(metadataId) {
  const leaf = String(metadataId).split("/").pop() ?? "";
  const words = leaf
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .split(/[\s_]+/)
    .filter(Boolean);
  return words.join(" ") || String(metadataId);
}
