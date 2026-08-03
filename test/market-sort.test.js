import test from "node:test";
import assert from "node:assert/strict";

import {
  compareMarketRows,
  DEFAULT_MARKET_SORT,
  nextMarketSort,
  rowSpread,
} from "../apps/web/lib/market-sort.js";

const rates = { exalted: 1, chaos: 0.02, divine: 100 };

function names(rows) {
  return rows.map((row) => row.targetName);
}

test("price columns sort by their normalized displayed values across mixed anchors", () => {
  const rows = [
    { targetName: "Seven Divine", anchor: "divine", low: 7, high: 8, reference: 7.5 },
    { targetName: "Ninety-eight Chaos", anchor: "chaos", low: 98, high: 99, reference: 98.5 },
    { targetName: "Ten Exalted", anchor: "exalted", low: 10, high: 11, reference: 10.5 },
  ];

  assert.deepEqual(
    names(rows.toSorted((a, b) => compareMarketRows(a, b, "buy:asc", { rates }))),
    ["Ninety-eight Chaos", "Ten Exalted", "Seven Divine"],
  );
  assert.deepEqual(
    names(rows.toSorted((a, b) => compareMarketRows(a, b, "sell:desc", { rates }))),
    ["Seven Divine", "Ten Exalted", "Ninety-eight Chaos"],
  );
  assert.deepEqual(
    names(rows.toSorted((a, b) => compareMarketRows(a, b, "price:asc", { rates }))),
    ["Ninety-eight Chaos", "Ten Exalted", "Seven Divine"],
  );
});

test("price sorting follows an explicitly selected display currency", () => {
  const rows = [
    { targetName: "Divine market", anchor: "divine", low: 0.1 },
    { targetName: "Exalted market", anchor: "exalted", low: 9 },
  ];

  assert.deepEqual(
    names(rows.toSorted((a, b) => compareMarketRows(a, b, "buy:asc", { displayCurrency: "chaos", rates }))),
    ["Exalted market", "Divine market"],
  );
});

test("missing converted prices stay at the bottom in both directions", () => {
  const rows = [
    { targetName: "Missing", anchor: "unknown", low: 1 },
    { targetName: "Known", anchor: "exalted", low: 10 },
  ];

  assert.deepEqual(
    names(rows.toSorted((a, b) => compareMarketRows(a, b, "buy:asc", { rates }))),
    ["Known", "Missing"],
  );
  assert.deepEqual(
    names(rows.toSorted((a, b) => compareMarketRows(a, b, "buy:desc", { rates }))),
    ["Known", "Missing"],
  );
});

test("rowSpread returns a numeric gap only for a valid low-to-high range", () => {
  assert.equal(rowSpread({ low: 80, high: 100 }), 0.25);
  assert.equal(rowSpread({ low: 100, high: 100 }), null);
  assert.equal(rowSpread({ low: null, high: 100 }), null);
});

test("a column header's third click restores in-game grouping", () => {
  let buySort = DEFAULT_MARKET_SORT;
  buySort = nextMarketSort(buySort, "buy", "asc");
  assert.equal(buySort, "buy:asc");
  buySort = nextMarketSort(buySort, "buy", "asc");
  assert.equal(buySort, "buy:desc");
  buySort = nextMarketSort(buySort, "buy", "asc");
  assert.equal(buySort, DEFAULT_MARKET_SORT);

  let sellSort = nextMarketSort(DEFAULT_MARKET_SORT, "sell");
  assert.equal(sellSort, "sell:desc");
  sellSort = nextMarketSort(sellSort, "sell");
  assert.equal(sellSort, "sell:asc");
  assert.equal(nextMarketSort(sellSort, "sell"), DEFAULT_MARKET_SORT);
});

test("switching columns starts the new column in its primary direction", () => {
  assert.equal(nextMarketSort("buy:desc", "movement", "desc"), "movement:desc");
  assert.equal(nextMarketSort("sell:asc", "name", "asc"), "name:asc");
});
