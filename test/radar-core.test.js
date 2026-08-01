import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRadarPayload,
  buildRadarPayloads,
  buildHistoryPayload,
  buildHotlistPayload,
  mergeRadarPayloads,
} from "../src/server/radar-core.js";

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
  icons: { divine: "https://web.poecdn.com/image/Art/2DItems/Currency/CurrencyModValues.png?scale=1" },
  categories: { divine: "StackableCurrency" },
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
  assert.match(divine.targetIcon, /^https:\/\/web\.poecdn\.com\/image\//);
  assert.equal(divine.gold.status, "supported");
  assert.equal(divine.displayPrice.unit, "divine");
  assert.ok(Math.abs(divine.displayPrice.value - 1) < 1e-9);
  assert.deepEqual(divine.hotlist, base.shortlist.includes("divine") ? divine.hotlist : null);
  assert.ok(divine.hotlist, "pinned shortlist target should be on the hotlist");

  const chaos = out.rows.find((row) => row.target === "chaos");
  assert.equal(chaos.status, "no-trades-this-hour");
  assert.equal(out.marketData.status, "available");
  assert.equal(out.marketData.pricedCandleCount, candles.length);
});

test("buildRadarPayloads reads the candle window once for every anchor snapshot", async () => {
  let reads = 0;
  const payloads = await buildRadarPayloads({
    ...base,
    repo: {
      ...repo,
      async readCandleWindow() {
        reads += 1;
        return candles;
      },
    },
    source: { sourceMode: "test" },
  });
  assert.equal(reads, 1);
  assert.deepEqual(Object.keys(payloads), ["exalted", "divine"]);
  assert.equal(payloads.exalted.anchor, "exalted");
  assert.equal(payloads.divine.anchor, "divine");
});

test("buildRadarPayload distinguishes upstream rows with no executed prices from an empty filter", async () => {
  const noTrades = candles.map((candle) => ({
    ...candle,
    low: null,
    high: null,
    reference: null,
  }));
  const out = await buildRadarPayload({
    ...base,
    repo: { ...repo, readCandleWindow: async () => noTrades },
    anchor: "exalted",
  });
  assert.equal(out.trackedCount, 0);
  assert.equal(out.marketData.status, "no-executed-trades");
  assert.equal(out.marketData.candleCount, noTrades.length);
  assert.equal(out.marketData.pricedCandleCount, 0);
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

test("mergeRadarPayloads picks the strongest native anchor row per target", () => {
  const merged = mergeRadarPayloads({
    exalted: { anchor: "exalted", generatedAt: new Date(NOW - 1000).toISOString(), rows: [
      { target: "rune", pairId: "exalted|rune", anchor: "exalted", status: "insufficient-history", samples: 2, coverage24h: 0.04, volume: 100, stale: false },
      { target: "divine", pairId: "divine|exalted", anchor: "exalted", status: "ok", samples: 20, stale: false },
    ] },
    divine: { anchor: "divine", generatedAt: new Date(NOW).toISOString(), rows: [
      { target: "rune", pairId: "divine|rune", anchor: "divine", status: "ok", samples: 10, coverage24h: 0.5, volume: 5, stale: false },
      { target: "exalted", pairId: "divine|exalted", anchor: "divine", status: "ok", samples: 20, stale: false },
    ] },
  }, { preferredAnchor: "exalted" });
  assert.equal(merged.rows.find((row) => row.target === "rune").sourceAnchor, "divine");
  assert.equal(merged.rows.find((row) => row.target === "divine").sourceAnchor, "exalted");
  assert.equal(merged.rows.some((row) => row.target === "exalted"), false, "inverse preferred-anchor duplicate is omitted");
  assert.equal(merged.trackedCount, 2);
  assert.deepEqual(merged.availableAnchors, ["exalted", "divine"]);
});
