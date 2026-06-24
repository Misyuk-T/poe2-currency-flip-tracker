import test from "node:test";
import assert from "node:assert/strict";

import { buildRadarPayload, buildHistoryPayload, buildHotlistPayload } from "../src/server/radar-core.js";

const HOUR = 3600_000;
const NOW = 1_700_000_000_000;
const LAST_HOUR = Math.floor(NOW / HOUR) * HOUR;

const manifest = [
  { id: "divine", name: "Divine Orb", category: "Currency", subcategory: "Currency", catalogOrder: 1, status: "supported", goldPerUnit: 100 },
  { id: "chaos", name: "Chaos Orb", category: "Currency", subcategory: "Currency", catalogOrder: 2, status: "supported", goldPerUnit: 50 },
  { id: "vaal", name: "Vaal Orb", category: "Currency", subcategory: "Currency", catalogOrder: 3, status: "supported", goldPerUnit: 25 },
];
const catalogById = new Map(manifest.map((item) => [item.id, item]));

// Six hourly divine|exalted candles ending at the latest completed hour.
const candles = Array.from({ length: 6 }, (_, k) => {
  const i = 5 - k;
  return {
    league: "Runes of Aldur",
    completedHour: LAST_HOUR - i * HOUR,
    digestId: 1000 - i,
    pairId: "divine|exalted",
    base: "divine",
    quote: "exalted",
    low: 200 + (5 - i),
    high: 220 + (5 - i),
    reference: 210 + (5 - i),
    referenceKind: "range-midpoint-proxy",
    volume: { divine: 5, exalted: 1000 },
    stock: {},
    source: "ggg-cxapi",
  };
});

const repo = {
  readCandleWindow: async () => candles,
  readPairCandles: async (pair) => (pair === "divine|exalted" ? candles : []),
  readCxapiState: async () => ({ cursor: null, lastDigestId: null }),
};

const base = {
  repo,
  anchors: ["exalted", "divine"],
  shortlist: ["divine"],
  names: { divine: "Divine Orb", exalted: "Exalted Orb" },
  catalogManifest: manifest,
  catalogById,
  now: NOW,
};

test("buildRadarPayload computes radar rows from candles and merges the catalog", async () => {
  const out = await buildRadarPayload({ ...base, anchor: "exalted", source: { sourceMode: "test" } });
  assert.equal(out.anchor, "exalted");
  assert.equal(out.trackedCount, 1);
  assert.equal(out.catalogCount, manifest.length); // 1 tracked (divine) + chaos/vaal no-trade

  const divine = out.rows.find((row) => row.target === "divine");
  assert.equal(divine.status, "ok");
  assert.equal(divine.gold.status, "supported");
  assert.equal(divine.displayPrice.unit, "divine");
  assert.ok(Math.abs(divine.displayPrice.value - 1) < 1e-9);
  assert.deepEqual(divine.hotlist, base.shortlist.includes("divine") ? divine.hotlist : null);
  assert.ok(divine.hotlist, "pinned shortlist target should be on the hotlist");

  const chaos = out.rows.find((row) => row.target === "chaos");
  assert.equal(chaos.status, "no-trades-this-hour");
});

test("buildHistoryPayload returns a pair's series in anchor units", async () => {
  const out = await buildHistoryPayload({ repo, pair: "divine|exalted", anchor: "exalted" });
  assert.equal(out.pair, "divine|exalted");
  assert.equal(out.series.length, 6);
  assert.ok(out.series.every((c) => c.target === "divine"));
  const unknownPair = await buildHistoryPayload({ repo, pair: "nope|nope", anchor: "exalted" });
  assert.deepEqual(unknownPair.series, []);
});

test("buildHotlistPayload pins the shortlist and reports no scheduler", async () => {
  const out = await buildHotlistPayload({ ...base });
  assert.ok(out.entries.some((entry) => entry.id === "divine"));
  assert.equal(out.scheduler.enabled, false);
});
