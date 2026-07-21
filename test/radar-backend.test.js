import test from "node:test";
import assert from "node:assert/strict";

// No database configured: getSql() returns null and data routes must degrade
// cleanly (never throw, never fabricate). Unset before importing the module.
delete process.env.DATABASE_URL;

const { getConfig, getStatus, getRadar, getHistory, resolveLeague, tradableRows } = await import("../apps/web/lib/radar-backend.js");

test("tradableRows drops no-trade catalog placeholders but keeps real markets", () => {
  const rows = [
    { target: "divine", pairId: "exalted|divine", status: "ok" },
    { target: "chaos", pairId: "exalted|chaos", status: "insufficient-history" },
    { target: "vaal", pairId: null, status: "no-trades-this-hour" },
    { target: "mystery", pairId: "exalted|mystery", status: "no-trades-this-hour" },
  ];
  const kept = tradableRows(rows).map((r) => r.target);
  assert.deepEqual(kept, ["divine", "chaos"]);
  assert.deepEqual(tradableRows(null), []);
});

test("getConfig returns public config with server-side opportunities disabled", async () => {
  const { status, body } = await getConfig();
  assert.equal(status, 200);
  assert.equal(body.game, "poe2");
  assert.ok(Array.isArray(body.anchors) && body.anchors.length > 0);
  assert.equal(body.features.liveBooks, false);
  assert.equal(body.features.radar, true);
  assert.equal(body.games.find((g) => g.id === "poe2")?.enabled, true);
  assert.equal(body.games.find((g) => g.id === "poe1")?.enabled, false);
  assert.deepEqual(body.games.find((g) => g.id === "poe2")?.leagues.map((l) => l.id), ["Runes of Aldur"]);
});

test("resolveLeague accepts configured leagues and rejects arbitrary scopes", () => {
  const config = { league: "Runes of Aldur", leagues: ["Runes of Aldur", "HC Runes of Aldur", "Standard"] };
  assert.deepEqual(resolveLeague(new URLSearchParams(), config), { league: "Runes of Aldur" });
  assert.deepEqual(resolveLeague(new URLSearchParams("league=Standard"), config), { league: "Standard" });
  const rejected = resolveLeague(new URLSearchParams("league=Private%20(PL123)"), config);
  assert.equal(rejected.error.status, 400);
  assert.equal(rejected.error.body.error.code, "invalid-league");
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
  assert.equal(body.ingestProviderMode, "fixture");
});

test("getHistory validates the pair id before infrastructure (400 even with no DB)", async () => {
  const bad = await getHistory(new URLSearchParams("pair=../../secret&anchor=exalted"));
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, "invalid-pair");

  const good = await getHistory(new URLSearchParams("pair=divine|exalted&anchor=exalted"));
  assert.equal(good.status, 503); // valid pair, but no DB
});

test("offline fixture fallback serves a full synthetic radar without a database", async () => {
  // Opt the fallback on explicitly (the default gate is NODE_ENV=development).
  process.env.RADAR_FIXTURE_FALLBACK = "1";
  try {
    const radar = await getRadar(new URLSearchParams("anchor=exalted"));
    assert.equal(radar.status, 200);
    assert.equal(radar.body.source.sourceMode, "fixture");
    assert.ok(radar.body.rows.length > 100, "expected the whole catalog as synthetic markets");
    assert.ok(
      radar.body.rows.every((r) => r.pairId && r.status !== "no-trades-this-hour"),
      "every served row is a tradable market",
    );

    const history = await getHistory(new URLSearchParams("pair=divine|exalted&anchor=exalted"));
    assert.equal(history.status, 200);
    assert.ok(history.body.series.length >= 2, "history has enough points to chart");
  } finally {
    delete process.env.RADAR_FIXTURE_FALLBACK;
  }
});
