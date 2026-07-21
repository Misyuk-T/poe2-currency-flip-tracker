import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeCxDigest, candleForAnchor } from "../src/domain/cx-market.js";
import { metadataToCanonicalId, ingestLiveStreams } from "../src/server/radar-ingest.js";

const EXALTED = "Metadata/Items/Currency/CurrencyAddModToRare";
const RUNE = "Metadata/Items/SoulCores/RuneWardSpecial3";
function streamHarness(recorded) {
  const market = {
    league: "Runes of Aldur",
    market_id: `${RUNE}|${EXALTED}`,
    lowest_ratio: { [RUNE]: 1, [EXALTED]: 5 },
    highest_ratio: { [RUNE]: 1, [EXALTED]: 5 },
    volume_traded: { [RUNE]: 2, [EXALTED]: 3 },
  };
  return {
    makeRepo: () => ({
      async readCxapiState() { return { cursor: 1000 }; },
      async recordCxDigest(d) { recorded.push(d); return d.candles.length; },
    }),
    makeProvider: () => ({
      configured: true,
      async fetchDigest({ id }) { return { digestId: id, payload: { next_change_id: id, markets: [market] } }; },
    }),
  };
}
const streamCfg = { league: "Runes of Aldur", cxapiSource: "cdn", cxapiStartId: null, cxapiMaxBackfillHours: 48 };

test("translate relabels base/quote/pairId/volume/stock keys, ratio read from raw ids", () => {
  const payload = {
    next_change_id: 2,
    markets: [
      {
        league: "L",
        market_id: "A|B",
        lowest_ratio: { A: 2, B: 1 }, // price = quote/base = B/A = 1/2
        highest_ratio: { A: 2, B: 1 },
        volume_traded: { A: 10, B: 20 },
        lowest_stock: { A: 3, B: 4 },
        highest_stock: { A: 3, B: 4 },
      },
    ],
  };
  const translate = (id) => ({ A: "aaa", B: "bbb" }[id] ?? id);
  const { candles } = normalizeCxDigest(payload, { digestId: 1, league: "L", translate });
  const c = candles[0];
  assert.equal(c.base, "aaa");
  assert.equal(c.quote, "bbb");
  assert.equal(c.pairId, "aaa|bbb");
  assert.equal(c.low, 0.5); // ratio still computed from the ORIGINAL A/B keys
  assert.deepEqual(c.volume, { aaa: 10, bbb: 20 });
  assert.deepEqual(c.stock.lowest, { aaa: 3, bbb: 4 });
});

// The Phase 3 unblock, proven on a REAL captured CDN market: with the cx-identity
// translator, the exalted anchor (short id) now matches the live candle — the
// exact thing the pre-mapping baseline test documented as broken.
const sample = JSON.parse(readFileSync(new URL("./fixtures/cdn-cx-sample.json", import.meta.url)));
const EXALTED_META = "Metadata/Items/Currency/CurrencyAddModToRare";

test("canonicalization fixes anchor matching: short-id 'exalted' matches live candles", () => {
  const { candles } = normalizeCxDigest(sample, {
    digestId: 1784613600,
    league: "Runes of Aldur",
    translate: metadataToCanonicalId,
  });
  // The exalted side is translated to the catalog short id.
  const exaltedPair = candles.find((c) => c.base === "exalted" || c.quote === "exalted");
  assert.ok(exaltedPair, "an exalted-denominated candle exists after translation");
  const target = exaltedPair.base === "exalted" ? exaltedPair.quote : exaltedPair.base;
  const anchored = candleForAnchor(exaltedPair, target, "exalted");
  assert.ok(anchored, "short-id anchor now resolves (was null pre-mapping)");
  assert.ok(Number.isFinite(anchored.reference));
  // The raw Metadata anchor id is gone from the stored candle.
  assert.notEqual(exaltedPair.base, EXALTED_META);
  assert.notEqual(exaltedPair.quote, EXALTED_META);
});

test("ingestLiveStreams canonicalizes PoE2 to short ids but passes PoE1 through", async () => {
  const rec2 = [];
  const h2 = streamHarness(rec2);
  await ingestLiveStreams({ streams: [{ game: "poe2", realm: "poe2" }], config: streamCfg, now: 1_784_600_000_000, makeRepo: h2.makeRepo, makeProvider: h2.makeProvider });
  const c2 = rec2.flatMap((d) => d.candles)[0];
  assert.ok(c2.base === "exalted" || c2.quote === "exalted", "poe2 exalted canonicalized");

  const rec1 = [];
  const h1 = streamHarness(rec1);
  await ingestLiveStreams({ streams: [{ game: "poe1", realm: "poe1" }], config: streamCfg, now: 1_784_600_000_000, makeRepo: h1.makeRepo, makeProvider: h1.makeProvider });
  const c1 = rec1.flatMap((d) => d.candles)[0];
  assert.ok(c1.base.startsWith("Metadata/") && c1.quote.startsWith("Metadata/"), "poe1 kept Metadata (no PoE2 ids)");
});

test("a collapsing translation drops the self-market", () => {
  const payload = { next_change_id: 2, markets: [{ league: "L", market_id: "A|B", lowest_ratio: { A: 1, B: 1 }, highest_ratio: { A: 1, B: 1 } }] };
  const { candles } = normalizeCxDigest(payload, { digestId: 1, league: "L", translate: () => "same" });
  assert.equal(candles.length, 0);
});

test("default (no translate) is passthrough — fixture short ids unchanged", () => {
  const payload = { next_change_id: 2, markets: [{ league: "L", market_id: "chaos|exalted", lowest_ratio: { chaos: 3, exalted: 1 }, highest_ratio: { chaos: 3, exalted: 1 } }] };
  const { candles } = normalizeCxDigest(payload, { digestId: 1, league: "L" });
  assert.equal(candles[0].base, "chaos");
  assert.equal(candles[0].quote, "exalted");
});
