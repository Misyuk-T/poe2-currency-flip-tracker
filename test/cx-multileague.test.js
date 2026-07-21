import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCxDigest, isPublicLeague } from "../src/domain/cx-market.js";
import { ingestLive } from "../src/server/radar-ingest.js";

const market = (league, id = "a|b") => ({
  league,
  market_id: id,
  lowest_ratio: { a: 1, b: 2 },
  highest_ratio: { a: 1, b: 2 },
  volume_traded: { a: 3, b: 4 },
  lowest_stock: { a: 10, b: 20 },
  highest_stock: { a: 10, b: 20 },
});

const payload = {
  next_change_id: 7200,
  markets: [
    market("Standard"),
    market("Runes of Aldur"),
    market("HC Runes of Aldur"),
    market("TAWERNA Runes of Aldur (PL83006)"), // private -> excluded
    market("battlerite refugees (PL83294)"), // private -> excluded
  ],
};

test("isPublicLeague keeps permanent/challenge leagues, drops private (PLxxxx)", () => {
  assert.equal(isPublicLeague("Standard"), true);
  assert.equal(isPublicLeague("HC Runes of Aldur"), true);
  assert.equal(isPublicLeague("TAWERNA Runes of Aldur (PL83006)"), false);
  assert.equal(isPublicLeague(""), false);
  assert.equal(isPublicLeague(null), false);
});

test("default (no league) keeps ALL public leagues, each candle carries its own", () => {
  const { candles } = normalizeCxDigest(payload, { digestId: 1 });
  const leagues = candles.map((c) => c.league).sort();
  assert.deepEqual(leagues, ["HC Runes of Aldur", "Runes of Aldur", "Standard"]);
  assert.ok(candles.every((c) => !/\(PL\d+\)/.test(c.league)));
});

test("leagues allow-list filters to an explicit set", () => {
  const { candles } = normalizeCxDigest(payload, { digestId: 1, leagues: ["Standard", "Runes of Aldur"] });
  assert.deepEqual(candles.map((c) => c.league).sort(), ["Runes of Aldur", "Standard"]);
});

test("legacy single-league path still filters to exactly one league", () => {
  const { candles } = normalizeCxDigest(payload, { digestId: 1, league: "Runes of Aldur" });
  assert.equal(candles.length, 1);
  assert.equal(candles[0].league, "Runes of Aldur");
});

test("league takes precedence over leagues when both are supplied", () => {
  const { candles } = normalizeCxDigest(payload, {
    digestId: 1,
    league: "Standard",
    leagues: ["Runes of Aldur", "HC Runes of Aldur"],
  });
  assert.deepEqual(candles.map((c) => c.league), ["Standard"]);
});

test("empty allow-list keeps nothing (not confused with the all-public default)", () => {
  const { candles } = normalizeCxDigest(payload, { digestId: 1, leagues: [] });
  assert.equal(candles.length, 0);
});

test("production single-league ingest records ONLY the requested league from a mixed digest", async () => {
  // Regression guard for Phase 2b: today's live caller passes an exact league, so
  // a mixed digest (other public + private leagues) must yield only that league.
  const provider = {
    configured: true,
    async fetchDigest() {
      return { digestId: 1, payload: { next_change_id: 1, markets: payload.markets } };
    },
  };
  const recorded = [];
  const repo = {
    async readCxapiState() { return { cursor: 1, lastDigestId: null }; },
    async recordCxDigest(d) { recorded.push(d); return d.candles.length; },
  };
  await ingestLive({ repo, provider, league: "Runes of Aldur", maxDigests: 1 });
  const leagues = new Set(recorded.flatMap((d) => d.candles.map((c) => c.league)));
  assert.deepEqual([...leagues], ["Runes of Aldur"]);
});

test("markets with a missing/non-string league are skipped", () => {
  const weird = {
    next_change_id: 7200,
    markets: [{ market_id: "a|b", lowest_ratio: { a: 1, b: 2 }, highest_ratio: { a: 1, b: 2 } }, // no league
             { league: 123, market_id: "a|b" }], // non-string league
  };
  const { candles } = normalizeCxDigest(weird, { digestId: 1 });
  assert.equal(candles.length, 0);
});
