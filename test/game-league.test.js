import { test } from "node:test";
import assert from "node:assert/strict";

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

test("config exposes a game/league catalog with PoE1 disabled (A7)", async () => {
  const app = createApp(loadConfig({ LEAGUE: "Test League", LEAGUES: "Test League,Old League" }), {
    provider: createFixtureProvider(),
    goldRegistry,
  });
  const r = mockRes();
  await app.handler(req("/api/config"), r);

  const games = r.body.games;
  assert.ok(Array.isArray(games));
  const poe2 = games.find((g) => g.id === "poe2");
  const poe1 = games.find((g) => g.id === "poe1");
  assert.equal(poe2.enabled, true);
  assert.equal(poe1.enabled, false);
  assert.equal(poe1.reason, "Coming later");
  assert.deepEqual(poe1.leagues, []);
});

test("only the active league is pollable; others advertised but disabled", async () => {
  const app = createApp(loadConfig({ LEAGUE: "Test League", LEAGUES: "Test League,Old League" }), {
    provider: createFixtureProvider(),
    goldRegistry,
  });
  const r = mockRes();
  await app.handler(req("/api/config"), r);

  const poe2 = r.body.games.find((g) => g.id === "poe2");
  assert.equal(poe2.activeLeague, "Test League");
  assert.equal(poe2.leagues.find((l) => l.id === "Test League").enabled, true);
  assert.equal(poe2.leagues.find((l) => l.id === "Old League").enabled, false);
});

test("the active league is always present even if omitted from LEAGUES", () => {
  const c = loadConfig({ LEAGUE: "Active", LEAGUES: "Other" });
  assert.ok(c.leagues.includes("Active"));
});
