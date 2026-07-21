/**
 * Build the PoE2 Currency Exchange identity map: Metadata id -> {name, class,
 * art, icon, shortId}.
 *
 * The public CX API keys every market by full Metadata paths
 * (Metadata/Items/<Class>/<Leaf>) with no names or icons. Names come from RePoE
 * (repoe-fork) base_items — GGPK-derived open data for tool developers, covering
 * 100% of observed CX currencies (validated: CurrencyAddModToRare -> Exalted Orb).
 * Icons are joined from our existing catalog-poe2.json by the shared 2D art path,
 * so the currency core keeps its official GGG image URLs; the long tail resolves
 * by name with no icon (yet).
 *
 * Usage: node scripts/build-identity.mjs
 * Attribution: item names derived from https://github.com/repoe-fork/repoe.
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import catalog from "../src/data/catalog-poe2.json" with { type: "json" };

const REPOE_URL = "https://repoe-fork.github.io/poe2/base_items.min.json";
const OUT = fileURLToPath(new URL("../src/data/cx-identity-poe2.json", import.meta.url));

/** RePoE visual_identity.dds_file "Art/2DItems/.../X.dds" -> "2DItems/.../X". */
function artFromDds(dds) {
  if (typeof dds !== "string") return null;
  return dds.replace(/^Art\//, "").replace(/\.dds$/i, "");
}

/** Join key: exact display name, case/space-normalized. Names are unique per
 *  item (tiers included: "Exalted Orb" vs "Greater Exalted Orb"), so joining on
 *  name — NOT on the shared 2D art path — avoids attaching a base item's icon/
 *  short-id to its Greater/Perfect variants. */
const nameKey = (name) => String(name).trim().toLowerCase().replace(/\s+/g, " ");

async function main() {
  // Catalog name -> { image, id }. First wins on the rare duplicate name.
  const catalogByName = new Map();
  for (const it of catalog.items ?? []) {
    const key = nameKey(it.name);
    if (key && !catalogByName.has(key)) catalogByName.set(key, { image: it.image, id: it.id });
  }

  const res = await fetch(REPOE_URL, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`RePoE returned ${res.status}`);
  const base = await res.json();

  const items = {};
  const shortIdOwner = new Map(); // shortId -> metaId, to keep the bridge unique
  let named = 0;
  let iconed = 0;
  for (const [metaId, entry] of Object.entries(base)) {
    if (!entry?.name) continue;
    const cat = catalogByName.get(nameKey(entry.name));
    // Only claim a short id if no earlier metadata already owns it (defensive;
    // exact-name joins should already be 1:1).
    let shortId = cat?.id ?? null;
    if (shortId && shortIdOwner.has(shortId)) shortId = null;
    else if (shortId) shortIdOwner.set(shortId, metaId);
    items[metaId] = {
      name: entry.name,
      class: entry.item_class ?? null,
      art: artFromDds(entry.visual_identity?.dds_file),
      icon: cat?.image ?? null,
      shortId,
    };
    named += 1;
    if (cat?.image) iconed += 1;
  }

  const out = {
    source: "repoe-fork poe2 base_items (GGPK-derived); icons joined by name from catalog-poe2.json",
    attribution: "item names from RePoE (https://github.com/repoe-fork/repoe, MIT). PoE data © GGG, used under their fan-content/API policy.",
    fetchedAt: new Date().toISOString().slice(0, 10),
    count: named,
    iconCount: iconed,
    items,
  };
  writeFileSync(OUT, JSON.stringify(out, null, 0));
  console.log(`wrote ${named} items (${iconed} with catalog icons) -> ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
