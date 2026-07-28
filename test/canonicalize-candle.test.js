import test from "node:test";
import assert from "node:assert/strict";

import { canonicalizeCandle } from "../src/domain/cx-market.js";
import { groupCandlesByPair } from "../src/storage/radar-repository.js";

const META = "Metadata/Items/Gems/SkillGemUncut1";
const SHORT = "uncut-skill-gem-1";
const canonicalId = (id) => (id === META ? SHORT : id);

function candle(base, quote, hour) {
  return {
    pairId: [base, quote].sort().join("|"),
    base,
    quote,
    completedHour: hour,
    low: 1,
    high: 2,
    reference: 1.5,
    volume: { [base]: 10, [quote]: 20 },
    stock: { [base]: 3, [quote]: 4 },
  };
}

test("a superseded id is rewritten everywhere it appears in the candle", () => {
  const out = canonicalizeCandle(candle(META, "exalted", 1), canonicalId);
  assert.equal(out.base, SHORT);
  assert.equal(out.pairId, "exalted|uncut-skill-gem-1");
  // volume and stock are keyed by currency id too — they have to move with it,
  // or the radar reads a volume of undefined for the renamed side.
  assert.equal(out.volume[SHORT], 10);
  assert.equal(out.stock[SHORT], 3);
  assert.equal(out.volume[META], undefined);
});

test("a candle needing no rewrite is returned untouched", () => {
  const original = candle("chaos", "exalted", 1);
  assert.equal(canonicalizeCandle(original, canonicalId), original);
});

test("history split across the id change groups as one market", () => {
  // The exact production shape: rows written before the identity fix carry the
  // Metadata path, rows after it carry the short id. Ungrouped they render as
  // two markets — one of them a phantom category holding a single item.
  const grouped = groupCandlesByPair(
    [candle(META, "exalted", 1), candle(SHORT, "exalted", 2)],
    { canonicalId },
  );
  assert.deepEqual(Object.keys(grouped), ["exalted|uncut-skill-gem-1"]);
  assert.equal(grouped["exalted|uncut-skill-gem-1"].length, 2);
});

test("without a resolver the grouping is exactly what it always was", () => {
  const grouped = groupCandlesByPair([candle(META, "exalted", 1), candle(SHORT, "exalted", 2)]);
  assert.equal(Object.keys(grouped).length, 2);
});

test("grouped candles stay sorted by hour after a rewrite", () => {
  const grouped = groupCandlesByPair(
    [candle(SHORT, "exalted", 5), candle(META, "exalted", 1), candle(META, "exalted", 3)],
    { canonicalId },
  );
  assert.deepEqual(
    grouped["exalted|uncut-skill-gem-1"].map((c) => c.completedHour),
    [1, 3, 5],
  );
});
