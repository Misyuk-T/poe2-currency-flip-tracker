import test from "node:test";
import assert from "node:assert/strict";

import { selectAutomaticAnchors } from "../src/domain/market-anchor.js";

test("automatic anchors choose the real Ruthless market hub", () => {
  const selected = selectAutomaticAnchors([
    { currency: "alchemy", pairCount: 18, sampleCount: 77 },
    { currency: "chaos", pairCount: 1, sampleCount: 13 },
  ], { fallbackAnchors: ["chaos", "divine", "exalted"] });
  assert.equal(selected.primary, "alchemy");
  assert.deepEqual(selected.anchors, ["alchemy", "chaos", "divine", "exalted"]);
});

test("automatic anchors keep a nearly-equal previous hub to avoid hourly flapping", () => {
  const selected = selectAutomaticAnchors([
    { currency: "divine", pairCount: 142, sampleCount: 2000 },
    { currency: "chaos", pairCount: 119, sampleCount: 2400 },
  ], {
    fallbackAnchors: ["chaos", "divine", "exalted"],
    previousAnchor: "chaos",
  });
  assert.equal(selected.primary, "chaos");
  assert.deepEqual(selected.anchors, ["chaos", "divine", "exalted"]);
});

test("automatic anchors fall back cleanly before a new league has priced data", () => {
  assert.deepEqual(
    selectAutomaticAnchors([], { fallbackAnchors: ["chaos", "divine"] }),
    { primary: "chaos", anchors: ["chaos", "divine"], candidates: [] },
  );
});
