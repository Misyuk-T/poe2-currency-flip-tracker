import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizeResult, normalizeOffer } from "../src/domain/offers.js";

const ENTRY = { side: "entry", anchorId: "exalted", targetId: "divine" };
const EXIT = { side: "exit", anchorId: "exalted", targetId: "divine" };

function listing(id, account, offers, indexed = "2026-06-19T10:00:00Z") {
  return { id, listing: { indexed, account: { name: account }, offers } };
}
const entryOffer = (ex, div, stock) => ({
  exchange: { currency: "exalted", amount: ex },
  item: { currency: "divine", amount: div, stock },
});
const exitOffer = (div, ex, stock) => ({
  exchange: { currency: "divine", amount: div },
  item: { currency: "exalted", amount: ex, stock },
});

test("case 1: result object (keyed by listing id) is normalized to levels", () => {
  const result = {
    L1: listing("L1", "a", [entryOffer(200, 1, 3)]),
    L2: listing("L2", "b", [entryOffer(210, 1, 50)]),
  };
  const levels = normalizeResult(result, ENTRY);
  assert.equal(levels.length, 2);
  assert.equal(levels[0].price, 200);
  assert.equal(levels[0].bundleTarget, 1);
  assert.equal(levels[0].availableTarget, 3);
  assert.equal(levels[1].price, 210);
  assert.equal(levels[1].availableTarget, 50);
});

test("case 2: malformed / wrong-direction offers are rejected", () => {
  assert.equal(normalizeOffer(entryOffer(0, 1, 3), { ...ENTRY, listingId: "x" }), null); // zero amount
  assert.equal(normalizeOffer(entryOffer(200, 0, 3), { ...ENTRY, listingId: "x" }), null); // zero target amount
  assert.equal(
    normalizeOffer(
      { exchange: { currency: "chaos", amount: 200 }, item: { currency: "divine", amount: 1, stock: 3 } },
      { ...ENTRY, listingId: "x" },
    ),
    null, // wrong have currency
  );
  assert.equal(normalizeOffer({ exchange: null, item: null }, { ...ENTRY, listingId: "x" }), null);
  // stock too small to fill one bundle -> dropped
  assert.equal(
    normalizeOffer(entryOffer(200, 5, 3), { ...ENTRY, listingId: "x" }),
    null,
  );
});

test("case 3: reverse direction normalizes to the same anchor-per-target convention", () => {
  const result = { X: listing("X", "c", [exitOffer(1, 215, 5000)]) };
  const [lvl] = normalizeResult(result, EXIT);
  assert.equal(lvl.side, "exit");
  assert.equal(lvl.price, 215); // anchor (exalted) per target (divine)
  assert.equal(lvl.bundleTarget, 1); // divine per bundle
  // stock is in anchor units: floor(5000/215)=23 bundles -> 23 divine fillable
  assert.equal(lvl.availableTarget, 23);
});

test("case 6 (part): duplicate listing ids are de-duplicated", () => {
  const result = {
    k1: listing("DUP", "a", [entryOffer(200, 1, 3)]),
    k2: listing("DUP", "a", [entryOffer(999, 1, 3)]),
  };
  const levels = normalizeResult(result, ENTRY);
  assert.equal(levels.length, 1);
  assert.equal(levels[0].price, 200);
});
