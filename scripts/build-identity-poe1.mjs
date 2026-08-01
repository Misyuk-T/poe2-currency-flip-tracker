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
import { buildIdentityTaxonomy } from "../src/domain/identity-taxonomy.js";
import { humanize } from "../src/domain/humanize.js";

const REPOE_URL = "https://repoe-fork.github.io/base_items.min.json";
const STATIC_URL = "https://www.pathofexile.com/api/trade/data/static";
const CX_DIGEST_URL = "https://web.poecdn.com/api/currency-exchange";
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

async function fetchObservedIds({ hoursBack = 6 } = {}) {
  const currentHour = Math.floor(Date.now() / 3600_000) * 3600;
  const observed = new Set();
  for (let back = 2; back <= hoursBack; back += 1) {
    const hour = currentHour - back * 3600;
    try {
      const response = await fetch(`${CX_DIGEST_URL}/${hour}`, { headers: { Accept: "application/json" } });
      if (!response.ok) continue;
      const payload = await response.json();
      for (const market of payload.markets ?? []) {
        for (const id of String(market?.market_id ?? "").split("|")) if (id) observed.add(id);
      }
    } catch {
      // Best effort; an empty set disables prefix learning rather than guessing.
    }
  }
  return observed;
}

async function main() {
  const [repoeRes, staticRes, observedIds] = await Promise.all([
    fetch(REPOE_URL, { headers: { Accept: "application/json" } }),
    fetch(STATIC_URL, { headers: { Accept: "application/json", "User-Agent": "exileradar.com identity build" } }),
    fetchObservedIds(),
  ]);
  if (!repoeRes.ok) throw new Error(`RePoE returned ${repoeRes.status}`);
  if (!staticRes.ok) throw new Error(`GGG static catalog returned ${staticRes.status}`);
  const base = await repoeRes.json();
  const staticData = await staticRes.json();
  const catalogItems = (staticData.result ?? []).flatMap((group) => (group.entries ?? []).map((entry) => ({
    id: entry.id,
    name: entry.text,
    category: group.label ?? group.id ?? "Unknown",
  })));

  const identityEntries = Object.fromEntries(Object.entries(base)
    .filter(([, entry]) => entry?.name)
    .map(([metaId, entry]) => [metaId, {
      name: entry.name,
      class: entry.item_class ?? null,
      art: artFromDds(entry.visual_identity?.dds_file),
      shortId: CORE_SHORT_IDS[metaId] ?? null,
    }]));
  for (const metaId of observedIds) {
    if (!identityEntries[metaId]) {
      identityEntries[metaId] = { name: humanize(metaId), class: null, art: null, shortId: CORE_SHORT_IDS[metaId] ?? null };
    }
  }
  const resolveTaxonomy = buildIdentityTaxonomy({ catalogItems, identities: identityEntries, observedIds });

  const items = {};
  let named = 0;
  let withArt = 0;
  const taxonomyCounts = {};
  for (const [metaId, entry] of Object.entries(identityEntries)) {
    const taxonomy = resolveTaxonomy(metaId, entry);
    items[metaId] = {
      ...entry,
      ...taxonomy,
    };
    taxonomyCounts[taxonomy.taxonomySource] = (taxonomyCounts[taxonomy.taxonomySource] ?? 0) + 1;
    named += 1;
    if (entry.art) withArt += 1;
  }

  const out = {
    source: "repoe-fork poe1 base_items (GGPK-derived); official trade taxonomy joined from GGG static data",
    attribution:
      "Item names and visual identities from RePoE (https://github.com/repoe-fork/repoe, MIT). PoE data © GGG, used under their fan-content/API policy.",
    fetchedAt: new Date().toISOString().slice(0, 10),
    count: named,
    iconCount: withArt,
    taxonomyCounts,
    items,
  };
  writeFileSync(OUT, JSON.stringify(out));
  console.log(`wrote ${named} PoE1 items (${withArt} with visual identities) -> ${OUT}`);
  console.log(`observed CX ids: ${observedIds.size}`);
  console.log("taxonomy:", taxonomyCounts);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
