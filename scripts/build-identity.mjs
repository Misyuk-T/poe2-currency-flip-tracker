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
import { tradedIdsFromDigest } from "../src/domain/identity-collision.js";
import { buildIdentityEntries } from "../src/domain/identity-resolve.js";

const REPOE_URL = "https://repoe-fork.github.io/poe2/base_items.min.json";
const CX_DIGEST_URL = "https://web.poecdn.com/api/currency-exchange/poe2";
const OUT = fileURLToPath(new URL("../src/data/cx-identity-poe2.json", import.meta.url));

/**
 * Metadata ids GGG currently lists markets for, used to settle name collisions.
 * The live edge may not be published yet, so walk back a few completed hours.
 * Best-effort: an empty set just means collisions fall back to a stable sort.
 */
async function fetchTradedIds({ hoursBack = 6 } = {}) {
  const currentHour = Math.floor(Date.now() / 3600_000) * 3600;
  const observed = new Set();
  for (let back = 2; back <= hoursBack; back += 1) {
    const hour = currentHour - back * 3600;
    try {
      const res = await fetch(`${CX_DIGEST_URL}/${hour}`, {
        headers: { Accept: "application/json", "User-Agent": "exileradar.com identity build" },
      });
      if (!res.ok) continue;
      const ids = tradedIdsFromDigest(await res.json());
      for (const id of ids) observed.add(id);
    } catch (err) {
      console.warn(`digest hour ${hour} failed: ${err.message}`);
    }
  }
  if (observed.size > 0) {
    console.log(`traded ids from recent completed hours: ${observed.size}`);
    return observed;
  }
  console.warn("no CX digest available — name collisions will fall back to a stable sort");
  return new Set();
}

async function main() {
  const res = await fetch(REPOE_URL, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`RePoE returned ${res.status}`);
  const base = await res.json();

  // Which ids GGG actually lists markets for; settles name collisions and seeds
  // the taxonomy's prefix learning. See src/domain/identity-resolve.js.
  const tradedIds = await fetchTradedIds();
  const { items, stats } = buildIdentityEntries({
    baseItems: base,
    catalogItems: catalog.items,
    observedIds: tradedIds,
    joinShortIdsByName: true,
    attachCatalogIcon: true,
  });
  const { named, iconed, contested, taxonomyCounts } = stats;

  const out = {
    source: "repoe-fork poe2 base_items (GGPK-derived); official trade taxonomy/icons joined from catalog-poe2.json",
    attribution: "item names from RePoE (https://github.com/repoe-fork/repoe, MIT). PoE data © GGG, used under their fan-content/API policy.",
    fetchedAt: new Date().toISOString().slice(0, 10),
    count: named,
    iconCount: iconed,
    taxonomyCounts,
    items,
  };
  writeFileSync(OUT, JSON.stringify(out, null, 0));
  console.log(`wrote ${named} items (${iconed} with catalog icons, ${contested} contested names) -> ${OUT}`);
  console.log("taxonomy:", taxonomyCounts);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
