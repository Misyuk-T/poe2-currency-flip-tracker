import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCxDigest, candleForAnchor, canonicalPairId } from "../src/domain/cx-market.js";

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
  assert.equal(d.candles[0].referenceKind, "range-midpoint-proxy");
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

test("invalid ratios remain null instead of fabricated", () => {
  const bad = { ...payload, markets: [{ ...payload.markets[0], lowest_ratio: { chaos: 0, divine: 1 } }] };
  const c = normalizeCxDigest(bad, { digestId: 3600, league: "L" }).candles[0];
  assert.equal(c.low, null);
  assert.equal(c.reference, null);
});
