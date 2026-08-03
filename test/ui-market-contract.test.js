import test from "node:test";
import assert from "node:assert/strict";

import { CATEGORY_ICON_IDS } from "../apps/web/lib/category-icons.js";
import { keyCurrencyCards } from "../apps/web/lib/key-currencies.js";
import { fallbackIconUrl, iconUrl } from "../apps/web/lib/market.js";
import { compareMarketRows } from "../apps/web/lib/market-sort.js";
import { quoteFromAnchor } from "../apps/web/lib/price-guidance.js";

const near = (actual, expected, tolerance = 1e-10) =>
  Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(actual), Math.abs(expected));

function rowsFromOracle(rates, edges) {
  return edges.map(([target, anchor]) => ({
    target,
    anchor,
    reference: rates[target] / rates[anchor],
    sparkline24h: [rates[target] / rates[anchor] * 0.98, rates[target] / rates[anchor]],
  }));
}

test("every curated category icon resolves to real official art", () => {
  for (const [category, source] of Object.entries(CATEGORY_ICON_IDS)) {
    const url = iconUrl(source);
    assert.notEqual(url, fallbackIconUrl, `${category} uses missing icon source ${source}`);
    assert.match(url, /^https:\/\/(?:web\.poecdn\.com|(?:www\.)?pathofexile\.com)\//, `${category} has an invalid icon URL`);
  }
});

test("key cards preserve currency units through direct, inverse, and multi-hop quotes", () => {
  const cases = [
    {
      name: "direct PoE2 anchor",
      anchor: "exalted",
      rates: { exalted: 1, chaos: 0.02, divine: 100 },
      edges: [["chaos", "exalted"], ["divine", "exalted"]],
    },
    {
      name: "production-shaped multi-hop quote",
      anchor: "exalted",
      rates: { exalted: 1, chaos: 0.12598815766974242 * 381.77873172820927, divine: 381.77873172820927 },
      edges: [["chaos", "divine"], ["divine", "exalted"]],
    },
    {
      name: "inverse graph edge",
      anchor: "exalted",
      rates: { exalted: 1, chaos: 0.025, divine: 120 },
      edges: [["exalted", "chaos"], ["divine", "exalted"]],
    },
    {
      name: "PoE1 chaos anchor",
      anchor: "chaos",
      rates: { chaos: 1, exalted: 8, divine: 190 },
      edges: [["exalted", "chaos"], ["divine", "chaos"]],
    },
  ];

  for (const scenario of cases) {
    const cards = keyCurrencyCards(rowsFromOracle(scenario.rates, scenario.edges), scenario.anchor);
    for (const card of cards) {
      const expected = scenario.rates[card.id] / scenario.rates[card.unit];
      assert.equal(card.available, true, `${scenario.name}: ${card.id} unavailable`);
      assert.ok(near(card.value, expected), `${scenario.name}: ${card.id}=${card.value} ${card.unit}, expected ${expected}`);
    }

    const anchorCard = cards.find((card) => card.id === scenario.anchor);
    const inverseCard = cards.find((card) => card.id === anchorCard.unit);
    assert.ok(near(anchorCard.value * inverseCard.value, 1), `${scenario.name}: reciprocal card rates are inconsistent`);
  }
});

test("display-price sorting is monotonic even when native row anchors differ", () => {
  const rates = { exalted: 1, chaos: 0.02, divine: 100 };
  const rows = [
    { targetName: "Divine native", anchor: "divine", low: 0.3, high: 0.4, reference: 0.35 },
    { targetName: "Chaos native", anchor: "chaos", low: 400, high: 450, reference: 425 },
    { targetName: "Exalted native", anchor: "exalted", low: 12, high: 15, reference: 13.5 },
  ];

  for (const token of ["buy:asc", "buy:desc", "sell:asc", "sell:desc", "price:asc", "price:desc"]) {
    const [key, direction] = token.split(":");
    const field = key === "buy" ? "low" : key === "sell" ? "high" : "reference";
    const sorted = rows.toSorted((a, b) => compareMarketRows(a, b, token, { rates }));
    const displayed = sorted.map((row) => quoteFromAnchor(row[field], { anchor: row.anchor, rates }).value);
    const expected = displayed.toSorted((a, b) => direction === "asc" ? a - b : b - a);
    assert.deepEqual(displayed, expected, `${token} mixes native anchor units`);
  }
});
