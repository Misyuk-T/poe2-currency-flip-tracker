import { test } from "node:test";
import assert from "node:assert/strict";

import { createApp } from "../src/server/app.js";
import { loadConfig } from "../src/server/config.js";
import { catalogTargets } from "../src/server/snapshot.js";
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

test("catalogTargets excludes the anchor and includes the other anchors", () => {
  assert.deepEqual(catalogTargets("exalted", ["divine", "chaos", "vaal"], ["exalted", "divine"]).sort(), [
    "chaos",
    "divine",
    "vaal",
  ]);
  assert.deepEqual(catalogTargets("divine", ["divine", "chaos", "vaal"], ["exalted", "divine"]).sort(), [
    "chaos",
    "exalted",
    "vaal",
  ]);
});

test("anchor selection returns differently-anchored opportunities", async () => {
  const app = createApp(loadConfig({ SHORTLIST: "divine,chaos,vaal" }), {
    provider: createFixtureProvider(),
    goldRegistry,
  });
  await app.refresh();

  const ex = mockRes();
  await app.handler(req("/api/opportunities?anchor=exalted"), ex);
  const dv = mockRes();
  await app.handler(req("/api/opportunities?anchor=divine"), dv);

  assert.equal(ex.body.anchorCurrency, "exalted");
  assert.equal(dv.body.anchorCurrency, "divine");
  // exalted anchor trades divine as a target; divine anchor trades exalted
  assert.ok(ex.body.opportunities.some((o) => o.targetCurrency === "divine"));
  assert.ok(dv.body.opportunities.some((o) => o.targetCurrency === "exalted"));
  // the same currency is priced differently under each anchor
  const exDivine = ex.body.opportunities.find((o) => o.targetCurrency === "divine");
  assert.ok(exDivine.entryVWAP > 1); // ~200 exalted per divine
});

test("an unknown anchor falls back to the default anchor", async () => {
  const app = createApp(loadConfig({ SHORTLIST: "divine" }), { provider: createFixtureProvider(), goldRegistry });
  await app.refresh();
  const r = mockRes();
  await app.handler(req("/api/opportunities?anchor=mirror"), r);
  assert.equal(r.body.anchorCurrency, "exalted");
});

test("config advertises the anchor set", async () => {
  const app = createApp(loadConfig({}), { provider: createFixtureProvider(), goldRegistry });
  const r = mockRes();
  await app.handler(req("/api/config"), r);
  assert.deepEqual(r.body.anchors, ["exalted", "divine"]);
});
