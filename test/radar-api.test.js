import test from "node:test";
import assert from "node:assert/strict";

import { createApp } from "../src/server/app.js";
import { loadConfig } from "../src/server/config.js";
import { createFixtureProvider } from "../src/providers/fixture-provider.js";
import { createGoldRegistry } from "../src/domain/gold-costs.js";
import { POE2_GOLD_COSTS } from "../src/data/gold-costs-poe2.js";
import { createLocalStorage } from "../src/storage/local-storage.js";
import { createRadarService } from "../src/server/radar-service.js";
import { loadCatalog, nameMapFromCatalog } from "../src/domain/catalog.js";

function res() {
  return { statusCode: 0, body: null, writeHead(code) { this.statusCode = code; }, end(body) { this.body = JSON.parse(body); } };
}
const req = (url) => ({ method: "GET", url, headers: {}, socket: {} });

async function fixtureApp() {
  const config = loadConfig({ SHORTLIST: "divine,chaos,vaal" });
  const provider = createFixtureProvider();
  const goldRegistry = createGoldRegistry(POE2_GOLD_COSTS, { game: "poe2" });
  const catalog = await loadCatalog();
  const storage = createLocalStorage(config, { dir: null });
  await storage.init({ mode: "fixture", game: config.poeGame, realm: config.poeRealm, league: config.league }, config.anchors);
  const radarService = createRadarService({
    config,
    storage,
    cxapiProvider: { configured: false },
    names: nameMapFromCatalog(catalog),
    fixtureItems: catalog.items,
    fixtureMode: true,
  });
  await radarService.init();
  return createApp(config, { provider, goldRegistry, catalog, storage, radarService });
}

test("radar API serves completed-hour rows, honest provenance and gold coverage", async () => {
  const app = await fixtureApp();
  const out = res();
  await app.handler(req("/api/radar?anchor=exalted"), out);
  assert.equal(out.statusCode, 200);
  assert.equal(out.body.source.sourceMode, "fixture");
  assert.ok(out.body.rows.length > 700);
  const radarCategories = new Set(out.body.rows.map((row) => row.category));
  for (const category of ["Currency", "Fragments", "Runes", "Essences", "Expedition", "Ritual", "Breach", "Delirium", "Vaal", "Verisium", "Abyssal Bones", "Uncut Gems", "Lineage Support Gems", "Waystones"]) {
    assert.ok(radarCategories.has(category), `fixture radar missing ${category}`);
  }
  const divine = out.body.rows.find((row) => row.target === "divine");
  assert.equal(divine.referenceKind, "range-midpoint-proxy");
  assert.equal(divine.category, "Currency");
  assert.equal(divine.gold.status, "supported");
  assert.equal(divine.sparkline24h.length, 25);
  assert.ok(!("close" in divine));
  assert.ok(out.body.units.divineInExalted > 1);
  assert.equal(divine.displayPrice.unit, "divine");
  assert.ok(Math.abs(divine.displayPrice.value - 1) < 1e-9);
  const cheap = out.body.rows.find((row) => row.reference > 0 && row.reference < out.body.units.divineInExalted);
  assert.equal(cheap.displayPrice.unit, "exalted");

  const divineAnchor = res();
  await app.handler(req("/api/radar?anchor=divine"), divineAnchor);
  assert.ok(divineAnchor.body.rows.length > 700);
  const exalted = divineAnchor.body.rows.find((row) => row.target === "exalted");
  assert.equal(exalted.displayPrice.unit, "exalted");
  assert.ok(Math.abs(exalted.displayPrice.value - 1) < 1e-9);
});

test("radar history validates pair ids and public status never exposes OAuth", async () => {
  const app = await fixtureApp();
  const invalid = res();
  await app.handler(req("/api/radar/history?pair=../../secret"), invalid);
  assert.equal(invalid.statusCode, 400);

  const status = res();
  await app.handler(req("/api/status"), status);
  assert.equal(status.body.radar.configured, false);
  assert.equal(JSON.stringify(status.body).includes("CXAPI_ACCESS_TOKEN"), false);
  assert.equal(JSON.stringify(status.body).includes("Bearer"), false);
});

test("radar API keeps catalog items with no hourly trades visible", async () => {
  const config = loadConfig({ ANCHORS: "exalted" });
  const provider = createFixtureProvider();
  const goldRegistry = createGoldRegistry(POE2_GOLD_COSTS, { game: "poe2" });
  const catalog = await loadCatalog();
  const radarService = {
    radar: () => [{
      pairId: "divine|exalted", target: "divine", targetName: "Divine Orb", anchor: "exalted",
      status: "ok", movement: {}, activityScore: 1, arbitrageScore: 1,
    }],
    hotlist: () => [],
    status: () => ({ sourceMode: "official" }),
    history: () => [],
  };
  const app = createApp(config, { provider, goldRegistry, catalog, radarService });
  const out = res();
  await app.handler(req("/api/radar?anchor=exalted"), out);
  assert.equal(out.body.trackedCount, 1);
  assert.equal(out.body.catalogCount, catalog.items.length - 1);
  const runeWithoutTrades = out.body.rows.find((row) => row.category === "Runes");
  assert.equal(runeWithoutTrades.status, "no-trades-this-hour");
  assert.equal(runeWithoutTrades.reference, null);
  assert.equal(runeWithoutTrades.activityScore, null);
  assert.deepEqual(runeWithoutTrades.sparkline24h, []);
  assert.deepEqual(runeWithoutTrades.displayPrice, { value: null, unit: null });
});
