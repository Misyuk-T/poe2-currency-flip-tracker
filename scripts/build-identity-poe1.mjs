/**
 * Build the PoE1 Currency Exchange identity map:
 * Metadata id -> { name, class, art, shortId }.
 *
 * The public CX digest carries only internal Metadata paths. RePoE provides the
 * matching display name, item class, and visual identity extracted from the
 * game data. The runtime turns `art` into an official web.poecdn.com image URL,
 * so GGG-owned artwork is never committed to this repository.
 *
 * Usage: node scripts/build-identity-poe1.mjs
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REPOE_URL = "https://repoe-fork.github.io/base_items.min.json";
const OUT = fileURLToPath(new URL("../src/data/cx-identity-poe1.json", import.meta.url));

const CORE_SHORT_IDS = Object.freeze({
  "Metadata/Items/Currency/CurrencyRerollRare": "chaos",
  "Metadata/Items/Currency/CurrencyModValues": "divine",
  "Metadata/Items/Currency/CurrencyAddModToRare": "exalted",
});

function artFromDds(dds) {
  if (typeof dds !== "string") return null;
  return dds.replace(/^Art\//, "").replace(/\.dds$/i, "");
}

async function main() {
  const res = await fetch(REPOE_URL, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`RePoE returned ${res.status}`);
  const base = await res.json();

  const items = {};
  let named = 0;
  let withArt = 0;
  for (const [metaId, entry] of Object.entries(base)) {
    if (!entry?.name) continue;
    const art = artFromDds(entry.visual_identity?.dds_file);
    items[metaId] = {
      name: entry.name,
      class: entry.item_class ?? null,
      art,
      shortId: CORE_SHORT_IDS[metaId] ?? null,
    };
    named += 1;
    if (art) withArt += 1;
  }

  const out = {
    source: "repoe-fork poe1 base_items (GGPK-derived)",
    attribution:
      "Item names and visual identities from RePoE (https://github.com/repoe-fork/repoe, MIT). PoE data © GGG, used under their fan-content/API policy.",
    fetchedAt: new Date().toISOString().slice(0, 10),
    count: named,
    iconCount: withArt,
    items,
  };
  writeFileSync(OUT, JSON.stringify(out));
  console.log(`wrote ${named} PoE1 items (${withArt} with visual identities) -> ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
