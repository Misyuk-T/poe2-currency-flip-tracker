import test from "node:test";
import assert from "node:assert/strict";

// No database configured: getSql() returns null and data routes must degrade
// cleanly (never throw, never fabricate). Unset before importing the module.
delete process.env.DATABASE_URL;

const { getConfig, getStatus, getRadar, getHistory } = await import("../apps/web/lib/radar-backend.js");

test("getConfig returns public config with server-side opportunities disabled", async () => {
  const { status, body } = await getConfig();
  assert.equal(status, 200);
  assert.equal(body.game, "poe2");
  assert.ok(Array.isArray(body.anchors) && body.anchors.length > 0);
  assert.equal(body.features.liveBooks, false);
  assert.equal(body.features.radar, true);
  assert.equal(body.games.find((g) => g.id === "poe2")?.enabled, true);
  assert.equal(body.games.find((g) => g.id === "poe1")?.enabled, false);
});

test("data routes degrade to 503 when DATABASE_URL is absent", async () => {
  const radar = await getRadar(new URLSearchParams("anchor=exalted"));
  assert.equal(radar.status, 503);
  assert.equal(radar.body.error.code, "no-database");
});

test("getStatus reports radar unconfigured without a database", async () => {
  const { status, body } = await getStatus();
  assert.equal(status, 200);
  assert.equal(body.radar.configured, false);
  assert.equal(body.providerMode, "fixture");
});

test("getHistory validates the pair id before infrastructure (400 even with no DB)", async () => {
  const bad = await getHistory(new URLSearchParams("pair=../../secret&anchor=exalted"));
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, "invalid-pair");

  const good = await getHistory(new URLSearchParams("pair=divine|exalted&anchor=exalted"));
  assert.equal(good.status, 503); // valid pair, but no DB
});
