import { test } from "node:test";
import assert from "node:assert/strict";

import { loadCatalog, buildManifest, nameMapFromCatalog } from "../src/domain/catalog.js";
import { createApp } from "../src/server/app.js";
import { loadConfig } from "../src/server/config.js";
import { createFixtureProvider } from "../src/providers/fixture-provider.js";
import { createGoldRegistry } from "../src/domain/gold-costs.js";
import { POE2_GOLD_COSTS } from "../src/data/gold-costs-poe2.js";

const goldRegistry = createGoldRegistry(POE2_GOLD_COSTS, { game: "poe2" });

function mockRes() {
  return {
    statusCode: null,
    body: null,
    writeHead(s) {
      this.statusCode = s;
    },
    end(p) {
      this.body = JSON.parse(p);
    },
  };
}
const req = (url) => ({ method: "GET", url, headers: {}, socket: {} });

test("the committed catalog has real GGG trade ids for our currencies", async () => {
  const cat = await loadCatalog();
  const byId = new Map(cat.items.map((i) => [i.id, i]));
  for (const id of ["exalted", "divine", "chaos", "vaal", "annul"]) {
    assert.ok(byId.has(id), `catalog missing ${id}`);
  }
  assert.equal(byId.get("exalted").name, "Exalted Orb");
});

test("every gold-table id resolves to a real catalog id (no guessed ids)", async () => {
  const cat = await loadCatalog();
  const ids = new Set(cat.items.map((i) => i.id));
  for (const r of POE2_GOLD_COSTS) {
    assert.ok(ids.has(r.itemId), `gold id "${r.itemId}" is not a real trade id`);
  }
});

test("buildManifest derives supported / unknown-gold-cost status + local icon path", async () => {
  const cat = await loadCatalog();
  const manifest = buildManifest(cat, goldRegistry);
  const exalted = manifest.find((m) => m.id === "exalted");
  assert.equal(exalted.status, "supported");
  assert.equal(exalted.goldPerUnit, 120);
  assert.equal(exalted.icon, "icons/exalted.png");
  const wisdom = manifest.find((m) => m.id === "wisdom"); // tradeable but no gold cost
  assert.equal(wisdom.status, "unknown-gold-cost");
  assert.equal(wisdom.goldPerUnit, null);
});

test("/api/catalog serves the manifest (no remote art URLs)", async () => {
  const catalog = await loadCatalog();
  const app = createApp(loadConfig({}), { provider: createFixtureProvider(), goldRegistry, catalog });
  const r = mockRes();
  await app.handler(req("/api/catalog"), r);
  assert.ok(r.body.count > 100);
  const item = r.body.items.find((i) => i.id === "divine");
  assert.equal(item.name, "Divine Orb");
  assert.equal("image" in item, false); // remote GGG art URL not exposed
});

test("nameMapFromCatalog maps ids to display names", async () => {
  const cat = await loadCatalog();
  assert.equal(nameMapFromCatalog(cat).vaal, "Vaal Orb");
});
