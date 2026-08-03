import test from "node:test";
import assert from "node:assert/strict";

import { currencyName, titleize } from "../apps/web/lib/market.js";

test("names come from GGG's catalog, with case and punctuation intact", () => {
  // These go into <title>, the h1 and the JSON-LD of indexable pages, where
  // title-casing the id is visibly wrong: "Perfect Orb Of Transmutation".
  assert.equal(currencyName("perfect-orb-of-transmutation"), "Perfect Orb of Transmutation");
  assert.equal(currencyName("perfect-jewellers-orb"), "Perfect Jeweller's Orb");
  assert.equal(currencyName("fenumus-rune-of-draining"), "Fenumus' Rune of Draining");
  assert.equal(currencyName("an-audience-with-the-king"), "An Audience with the King");
});

test("the popular list still wins, so its hand-written copy stays authoritative", () => {
  assert.equal(currencyName("divine"), "Divine Orb");
  assert.equal(currencyName("exalted"), "Exalted Orb");
  assert.equal(currencyName("alchemy"), "Orb of Alchemy");
});

test("an id the catalog has never heard of still gets a readable name", () => {
  assert.equal(currencyName("made-up-id-xyz"), titleize("made-up-id-xyz"));
  assert.equal(currencyName("made-up-id-xyz"), "Made Up Id Xyz");
});
