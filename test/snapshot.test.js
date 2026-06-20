import { test } from "node:test";
import assert from "node:assert/strict";

import { fetchBooks, computeOpportunities } from "../src/server/snapshot.js";
import { createFixtureProvider } from "../src/providers/fixture-provider.js";
import { createApp } from "../src/server/app.js";
import { loadConfig } from "../src/server/config.js";
import { createGoldRegistry } from "../src/domain/gold-costs.js";
import { POE2_GOLD_COSTS } from "../src/data/gold-costs-poe2.js";

const goldRegistry = createGoldRegistry(POE2_GOLD_COSTS, { game: "poe2" });

test("fixture provider + snapshot produce ranked opportunities (no exceptions)", async () => {
  const provider = createFixtureProvider({}, { freshenIndexed: true });
  const books = await fetchBooks(provider, { anchorId: "exalted", shortlist: ["divine", "chaos", "vaal"] });
  const opps = computeOpportunities({
    books,
    goldRegistry,
    constraints: { currencyCapital: 1000, goldAvailable: 1e9, goldReserve: 0 },
    maxListingAgeMs: null,
  });
  assert.equal(opps.length, 3);
  const ids = opps.map((o) => o.targetCurrency).sort();
  assert.deepEqual(ids, ["chaos", "divine", "vaal"]);
  // divine has positive spread; chaos round trip is negative
  const chaos = opps.find((o) => o.targetCurrency === "chaos");
  assert.ok(chaos.grossProfit <= 0);
  const vaal = opps.find((o) => o.targetCurrency === "vaal");
  assert.ok(vaal.warnings.includes("unknown-gold-cost"));
});

test("empty book yields a degenerate (not fabricated) opportunity", () => {
  const books = { anchorId: "exalted", byTarget: { divine: { entryLevels: [], exitLevels: [] } } };
  const opps = computeOpportunities({
    books,
    goldRegistry,
    constraints: { currencyCapital: 1000, goldAvailable: 1e9, goldReserve: 0 },
  });
  assert.equal(opps.length, 1);
  assert.equal(opps[0].quantity, 0);
  assert.equal(opps[0].grossProfit, 0);
  assert.ok(opps[0].warnings.includes("no-liquidity"));
});

test("case 12: provider failure with no snapshot -> 503 error, no opportunities fabricated", async () => {
  const failingProvider = {
    mode: "live",
    label: "failing",
    async fetchExchange() {
      throw new Error("boom");
    },
  };
  const config = loadConfig({ PROVIDER_MODE: "live" });
  const app = createApp(config, { provider: failingProvider, goldRegistry });

  // Only the scheduler hits the provider; reads never do. Drive one failed cycle.
  await app.refresh();

  const res = mockRes();
  await app.handler({ method: "GET", url: "/api/opportunities", headers: {}, socket: {} }, res);

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.state, "error");
  assert.ok(res.body.opportunities === undefined);
  assert.ok(res.body.error);
});

test("health and config endpoints respond", async () => {
  const provider = createFixtureProvider();
  const config = loadConfig({});
  const app = createApp(config, { provider, goldRegistry });

  const health = mockRes();
  await app.handler({ method: "GET", url: "/health" }, health);
  assert.equal(health.statusCode, 200);
  assert.equal(health.body.status, "ok");

  const cfg = mockRes();
  await app.handler({ method: "GET", url: "/api/config" }, cfg);
  assert.equal(cfg.statusCode, 200);
  assert.equal(cfg.body.providerMode, "fixture");
  assert.ok(Array.isArray(cfg.body.shortlist));
});

test("C2: opportunity API surfaces per-target market fetch freshness", async () => {
  const provider = createFixtureProvider();
  const config = loadConfig({ SHORTLIST: "divine" });
  const app = createApp(config, { provider, goldRegistry });
  await app.refresh();
  const res = mockRes();
  await app.handler({ method: "GET", url: "/api/opportunities", headers: {}, socket: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.opportunities[0].marketFreshness.tier, "manual");
  assert.equal(typeof res.body.opportunities[0].marketFreshness.fetchedAt, "string");
  assert.ok(res.body.opportunities[0].marketFreshness.ageMs >= 0);
});

function mockRes() {
  return {
    statusCode: null,
    headers: null,
    body: null,
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers;
    },
    end(payload) {
      try {
        this.body = JSON.parse(payload);
      } catch {
        this.body = payload;
      }
    },
  };
}
