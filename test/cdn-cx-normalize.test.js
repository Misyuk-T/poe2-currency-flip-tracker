import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeCxDigest, candleForAnchor } from "../src/domain/cx-market.js";

// A trimmed but REAL CDN response (poe2 realm, "Runes of Aldur"), captured
// 2026-07-21. Pins how the domain handles the live shape BEFORE the Phase 2
// identity/mapping layer: market_id components are full Metadata paths and
// ratios are integer pairs. When mapping lands, base/quote become canonical
// ids and this test's expectations update deliberately.
const sample = JSON.parse(
  readFileSync(new URL("./fixtures/cdn-cx-sample.json", import.meta.url)),
);

const EXALTED_META = "Metadata/Items/Currency/CurrencyAddModToRare";
// NB: the Metadata prefix varies by item class (Currency, SoulCores, ...), so a
// leaf-only map is insufficient — full paths are the identity. This one is a
// Soul Core, not a Currency.
const RUNE_META = "Metadata/Items/SoulCores/RuneWardSpecial3";

test("normalizes real CDN markets: integer ratio pair -> quote/base price", () => {
  const { candles } = normalizeCxDigest(sample, {
    digestId: 1784613600,
    league: "Runes of Aldur",
  });
  assert.equal(candles.length, sample.markets.length);
  const rune = candles.find((c) => c.base === RUNE_META || c.quote === RUNE_META);
  assert.ok(rune, "rune market present");
  // Live ratio was { RuneWardSpecial3: 1, CurrencyAddModToRare(exalted): 5 } ->
  // base=rune, quote=exalted -> price = quote/base = 5 exalted per rune.
  assert.equal(rune.low, 5);
  assert.equal(rune.high, 5);
});

test("stores Metadata paths as base/quote today (pre-mapping baseline)", () => {
  const { candles } = normalizeCxDigest(sample, {
    digestId: 1784613600,
    league: "Runes of Aldur",
  });
  for (const c of candles) {
    assert.match(c.base, /^Metadata\/Items\//);
    assert.match(c.quote, /^Metadata\/Items\//);
  }
});

test("DOCUMENTS the anchor-namespace bug: short id 'exalted' matches no live candle", () => {
  // candleForAnchor compares against the stored id namespace. Live candles hold
  // Metadata paths, so the configured short-id anchor 'exalted' resolves nothing.
  // This is the Phase 2 blocker; the Metadata id DOES resolve.
  const { candles } = normalizeCxDigest(sample, {
    digestId: 1784613600,
    league: "Runes of Aldur",
  });
  const anchored = candles.map((c) => candleForAnchor(c, c.base, "exalted")).filter(Boolean);
  assert.equal(anchored.length, 0, "short-id anchor matches nothing (the bug)");

  const rune = candles.find((c) => c.base === RUNE_META);
  const viaMeta = candleForAnchor(rune, RUNE_META, EXALTED_META);
  assert.ok(viaMeta, "Metadata-id anchor resolves the same market");
  assert.equal(viaMeta.reference, 5);
});
