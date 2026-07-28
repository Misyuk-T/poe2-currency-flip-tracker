import test from "node:test";
import assert from "node:assert/strict";

import {
  ERRATIC_SPREAD_RATIO,
  IMPLAUSIBLE_MARGIN,
  MIN_OBSERVATIONS,
  planReliability,
} from "../apps/web/lib/plan-reliability.js";

/** A steady series: enough hours, prices within a normal band. */
const steady = () => Array.from({ length: 24 }, (_, i) => ({ reference: 100 + (i % 5) }));

test("a steady, well-observed market is usable", () => {
  const result = planReliability(steady(), { rangePotential: 0.04 });
  assert.equal(result.usable, true);
  assert.equal(result.reason, null);
  assert.equal(result.observations, 24);
});

test("a market with barely any completed hours is rejected", () => {
  const points = Array.from({ length: MIN_OBSERVATIONS - 1 }, () => ({ reference: 100 }));
  const result = planReliability(points, { rangePotential: 0.03 });
  assert.equal(result.usable, false);
  assert.equal(result.reason, "too-few-observations");
  assert.match(result.detail, /5 completed hours/);
});

test("the Fracturing Orb case: prices spanning orders of magnitude are rejected", () => {
  // The real report that prompted this: a window ranging from 1 to 4,500 with
  // a headline margin of 61%.
  const points = [
    { reference: 1 },
    { reference: 3200 },
    { reference: 4500 },
    { reference: 2800 },
    { reference: 3100 },
    { reference: 2 },
    { reference: 3000 },
  ];
  const result = planReliability(points, { rangePotential: 0.61 });
  assert.equal(result.usable, false);
  assert.equal(result.reason, "erratic-prices");
  assert.match(result.detail, /swing 4500×/);
});

test("an absurd margin is rejected even when the price series looks calm", () => {
  const result = planReliability(steady(), { rangePotential: IMPLAUSIBLE_MARGIN + 0.5 });
  assert.equal(result.usable, false);
  assert.equal(result.reason, "implausible-margin");
});

test("a genuinely good margin is not mistaken for noise", () => {
  // Real flips do clear double digits; only the absurd end is filtered.
  const result = planReliability(steady(), { rangePotential: 0.35 });
  assert.equal(result.usable, true);
});

test("checks are ordered so the most fundamental problem is reported", () => {
  // Too few points AND erratic: the honest complaint is the sample size.
  const result = planReliability([{ reference: 1 }, { reference: 5000 }], { rangePotential: 9 });
  assert.equal(result.reason, "too-few-observations");
});

test("the spread ratio sits right at the boundary without tripping", () => {
  const points = Array.from({ length: 10 }, (_, i) => ({ reference: i === 0 ? 100 : 100 * ERRATIC_SPREAD_RATIO }));
  assert.equal(planReliability(points, { rangePotential: 0.1 }).usable, true);
});

test("unusable prices are ignored rather than counted as observations", () => {
  const points = [
    { reference: 100 }, { reference: null }, { reference: 0 },
    { reference: "x" }, { reference: 101 }, { reference: -5 },
  ];
  const result = planReliability(points, { rangePotential: 0.02 });
  assert.equal(result.observations, 2);
  assert.equal(result.reason, "too-few-observations");
});

test("an empty history is rejected rather than throwing", () => {
  const result = planReliability([], {});
  assert.equal(result.usable, false);
  assert.equal(result.observations, 0);
  assert.equal(planReliability(undefined, {}).usable, false);
});

test("a missing margin does not make an otherwise steady market unusable", () => {
  assert.equal(planReliability(steady(), {}).usable, true);
  assert.equal(planReliability(steady(), { rangePotential: null }).usable, true);
});
