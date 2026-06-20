import { test } from "node:test";
import assert from "node:assert/strict";

import { buildBook, sweep, bookDepth, reachableQuantities, canFullyFill } from "../src/domain/order-book.js";

function lvl(side, price, bundleTarget, availableTarget, account = "acc", indexed = "2026-06-19T10:00:00Z") {
  return { side, listingId: `${price}-${account}`, account, indexed, price, bundleTarget, availableTarget };
}

test("case 4: VWAP across multiple price levels (entry, ascending)", () => {
  const book = buildBook([
    lvl("entry", 210, 1, 50, "c"),
    lvl("entry", 200, 1, 3, "a"),
    lvl("entry", 205, 1, 10, "b"),
  ]);
  assert.deepEqual(book.map((l) => l.price), [200, 205, 210]); // sorted cheapest-first

  const s = sweep(book, 5); // 3 @200 + 2 @205
  assert.equal(s.filledTarget, 5);
  assert.equal(s.unfilledTarget, 0);
  assert.equal(s.anchorAmount, 3 * 200 + 2 * 205); // 1010
  assert.equal(s.vwap, 1010 / 5); // 202
  assert.equal(s.worstPrice, 205);
  assert.equal(s.levelsUsed, 2);
  assert.equal(s.uniqueAccounts, 2);
});

test("exit book sorts highest-first and sweeps best prices", () => {
  const book = buildBook([
    lvl("exit", 208, 1, 100, "x"),
    lvl("exit", 215, 1, 5, "y"),
    lvl("exit", 212, 1, 100, "z"),
  ]);
  assert.deepEqual(book.map((l) => l.price), [215, 212, 208]);
  const s = sweep(book, 10); // 5 @215 + 5 @212
  assert.equal(s.anchorAmount, 5 * 215 + 5 * 212); // received anchor
  assert.equal(s.vwap, (5 * 215 + 5 * 212) / 10);
});

test("case 5: stock/bundle-size limits and partial fill", () => {
  // one level, bundle of 5, only 1 bundle (5 units) available
  const book = buildBook([lvl("entry", 0.6, 5, 5, "a")]);
  const s = sweep(book, 7); // can only fit one whole bundle (5) within remaining
  assert.equal(s.filledTarget, 5);
  assert.equal(s.unfilledTarget, 2);
  assert.equal(s.anchorAmount, 5 * 0.6);
});

test("requesting less than a bundle fills nothing from that level", () => {
  const book = buildBook([lvl("entry", 1, 5, 100, "a")]);
  const s = sweep(book, 3);
  assert.equal(s.filledTarget, 0);
  assert.equal(s.unfilledTarget, 3);
});

test("case 6 (part): repeated account counts once toward unique depth", () => {
  const book = buildBook([lvl("entry", 200, 1, 10, "same"), lvl("entry", 205, 1, 10, "same")]);
  const s = sweep(book, 20);
  assert.equal(s.uniqueAccounts, 1);
  assert.equal(bookDepth(book), 20);
});

// Regression (Codex #1): a cheap level with a bundle LARGER than the cap must
// not zero out the reachable set — greedy sweep skips it and fills from the
// later, worse, smaller-bundle level. The old prefix-sum enumeration returned []
// here, falsely marking such opportunities non-actionable.
test("reachableQuantities matches greedy sweep across mixed bundle sizes (oversized early level)", () => {
  // cheap bundleTarget=5 available=100, then worse bundleTarget=1 available=10.
  const book = buildBook([lvl("entry", 200, 5, 100, "cheap"), lvl("entry", 210, 1, 10, "worse")]);
  // cap=3: the cheap bundle of 5 cannot fit, but the worse level fills 1/2/3.
  assert.deepEqual(reachableQuantities(book, 3), [1, 2, 3]);
  assert.equal(sweep(book, 3).filledTarget, 3);
  for (const q of [1, 2, 3]) assert.ok(canFullyFill(book, q), `q=${q} should be fully fillable`);
});

test("reachableQuantities matches a brute-force sweep over several mixed books", () => {
  const brute = (book, cap) => {
    const out = [];
    for (let q = 1; q <= cap; q++) if (Math.abs(sweep(book, q).filledTarget - q) < 1e-9) out.push(q);
    return out;
  };
  const cases = [
    buildBook([lvl("entry", 200, 5, 100), lvl("entry", 210, 1, 10)]),
    buildBook([lvl("entry", 1, 3, 3), lvl("entry", 2, 2, 1000)]), // skip then fill
    buildBook([lvl("entry", 1, 4, 4), lvl("entry", 2, 3, 60)]),
    buildBook([lvl("entry", 1, 6, 6), lvl("entry", 2, 4, 8), lvl("entry", 3, 1, 5)]),
  ];
  for (const book of cases) {
    const cap = 40;
    assert.deepEqual(reachableQuantities(book, cap), brute(book, cap));
  }
});
