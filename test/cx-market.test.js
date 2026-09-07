import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeCxDigest, candleForAnchor, canonicalPairId, hourlyTradedVolumeReference } from "../src/domain/cx-market.js";

const payload = {
  next_change_id: 7200,
  markets: [{
    league: "L", market_id: "chaos|divine",
    volume_traded: { chaos: 1000, divine: 10 },
    lowest_stock: { chaos: 100, divine: 1 }, highest_stock: { chaos: 200, divine: 2 },
    lowest_ratio: { chaos: 100, divine: 1 }, highest_ratio: { chaos: 80, divine: 1 },
  }, { league: "Other", market_id: "chaos|divine", lowest_ratio: {}, highest_ratio: {} }],
};

test("cxapi digest filters league and normalizes a range without fake close", () => {
  const d = normalizeCxDigest(payload, { digestId: 3600, league: "L" });
  assert.equal(d.candles.length, 1);
  assert.equal(d.candles[0].pairId, canonicalPairId("chaos", "divine"));
  assert.equal(d.candles[0].low, 0.01);
  assert.equal(d.candles[0].high, 0.0125);
  assert.equal(d.candles[0].reference, 0.01);
  assert.equal(d.candles[0].referenceKind, "hourly-traded-volume-ratio");
  assert.equal("close" in d.candles[0], false);
});

test("anchor projection handles direct and inverse pair orientation", () => {
  const c = normalizeCxDigest(payload, { digestId: 3600, league: "L" }).candles[0];
  const direct = candleForAnchor(c, "chaos", "divine");
  assert.equal(direct.low, 0.01);
  const inverse = candleForAnchor(c, "divine", "chaos");
  assert.equal(inverse.low, 80);
  assert.equal(inverse.high, 100);
});

test("a pair's storage orientation recomputes the traded-volume ratio", () => {
  const c = normalizeCxDigest(payload, { digestId: 3600, league: "L" }).candles[0];
  const direct = candleForAnchor(c, "chaos", "divine");
  const inverse = candleForAnchor(c, "divine", "chaos");

  assert.ok(Math.abs(inverse.reference - 1 / direct.reference) < 1e-12, "quoting the pair the other way must invert the price exactly");
  for (const candle of [direct, inverse]) {
    assert.ok(candle.reference >= candle.low && candle.reference <= candle.high, "the ratio must sit inside its reported range");
    assert.equal(candle.referenceKind, "hourly-traded-volume-ratio");
  }
});

test("captured public Divine / Exalted volume ratios are preserved exactly", () => {
  const [captured] = JSON.parse(readFileSync(new URL("./fixtures/public-divine-exalted-volume.json", import.meta.url), "utf8"));
  const base = "Metadata/Items/Currency/CurrencyModValues";
  const quote = "Metadata/Items/Currency/CurrencyAddModToRare";
  const candle = {
    base, quote, low: 1, high: 130,
    volume: captured.volume_traded,
  };
  const direct = hourlyTradedVolumeReference(candle);
  assert.equal(direct, 4631244 / 36913);
  assert.ok(Math.abs(direct - 125.463766) < 1e-6);
  assert.equal(candleForAnchor(candle, quote, base).reference, 1 / direct);
});

test("missing, invalid and out-of-band volumes never fabricate a reference", () => {
  const bad = { ...payload, markets: [{ ...payload.markets[0], lowest_ratio: { chaos: 0, divine: 1 } }] };
  const c = normalizeCxDigest(bad, { digestId: 3600, league: "L" }).candles[0];
  assert.equal(c.low, null);
  assert.equal(c.reference, null);
  for (const volume of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "100"]) {
    assert.equal(hourlyTradedVolumeReference({ base: "a", quote: "b", low: 1, high: 3, volume: { a: 1, b: volume } }), null);
  }
  assert.equal(hourlyTradedVolumeReference({ base: "a", quote: "b", low: 1, high: 3, volume: { a: 1, b: 4 } }), null);
  // Tolerance is relative to each bound. A global absolute epsilon would accept
  // this tiny-range value and this large-range lower-bound violation.
  assert.equal(hourlyTradedVolumeReference({ base: "a", quote: "b", low: 1e-300, high: 1e-200, volume: { a: 1, b: 1e-100 } }), null);
  assert.equal(hourlyTradedVolumeReference({ base: "a", quote: "b", low: 1e100, high: 1e300, volume: { a: 1, b: 1e99 } }), null);
});

test("anchor projection ignores a stored legacy reference", () => {
  const candle = {
    base: "a", quote: "b", low: 1, high: 3,
    reference: Math.sqrt(3), referenceKind: "range-center-geometric",
    volume: { a: 10, b: 20 },
  };
  const projected = candleForAnchor(candle, "a", "b");
  assert.equal(projected.reference, 2);
  assert.equal(projected.referenceKind, "hourly-traded-volume-ratio");
});
