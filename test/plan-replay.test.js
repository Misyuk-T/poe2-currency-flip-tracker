import test from "node:test";
import assert from "node:assert/strict";

import { replayPlan } from "../apps/web/lib/price-guidance.js";

const HOUR = 3600_000;

/** A decision at price 100, followed by the given hourly low/high pairs. */
function window(...hours) {
  return {
    start: { reference: 100, completedHour: 0 },
    future: hours.map(([low, high], i) => ({ completedHour: (i + 1) * HOUR, low, high })),
  };
}

// Buy at 90, sell at 110.
const PLAN = { entryFactor: 0.9, exitFactor: 1.1 };

test("a sell that happens before the buy is not evidence for the plan", () => {
  // The exact failure this replaces: hour 1 spikes to 120 (above the sell) while
  // never dipping to 90; the price only reaches the buy afterwards, and never
  // recovers. The old check asked "did any later high reach the sell price?" and
  // scored this a hit.
  const result = replayPlan([window([95, 120], [88, 92], [85, 89])], PLAN);
  assert.equal(result.entryFillRate, 1, "the buy did eventually fill, in hour 2");
  assert.equal(result.exitAfterEntryRate, 0, "but the sell never came after it");
  assert.equal(result.medianHoursHeld, null);
});

test("a completed round trip is timed from the buy, not from the decision", () => {
  // Buy fills in hour 2; sell lands in hour 5. The wait a trader experiences is
  // three hours, not the five since they looked at the screen.
  const result = replayPlan(
    [window([95, 99], [88, 95], [92, 100], [93, 105], [95, 115])],
    PLAN,
  );
  assert.equal(result.entryFillRate, 1);
  assert.equal(result.exitAfterEntryRate, 1);
  assert.equal(result.medianHoursHeld, 3);
});

test("a sell in the same hour as the buy is unanswerable, not a failure", () => {
  // GGG publishes an hour's low and high with no ordering between them, so this
  // hour cannot show the sell followed the buy. With no hour after the fill the
  // question has no answer — reporting 0% would blame the plan for the horizon.
  const sameHour = replayPlan([window([88, 115])], PLAN);
  assert.equal(sameHour.entryFillRate, 1);
  assert.equal(sameHour.exitAfterEntryRate, null);
  assert.equal(sameHour.observableSamples, 0);

  const nextHour = replayPlan([window([88, 95], [100, 115])], PLAN);
  assert.equal(nextHour.exitAfterEntryRate, 1);
  assert.equal(nextHour.medianHoursHeld, 1);
});

test("a plan whose buy never fills counts against the fill rate, not the hit rate", () => {
  const result = replayPlan([window([95, 130], [96, 125])], PLAN);
  assert.equal(result.entryFillRate, 0);
  assert.equal(result.filled, 0);
  assert.equal(result.exitAfterEntryRate, null, "no filled trades means the question is unanswerable");
  assert.equal(result.medianAdverseMove, null);
});

test("the drawdown is measured against the buy price and stops at the sell", () => {
  // Buy at 90 in hour 1, dips to 81 (-10%) in hour 2, sells in hour 3. The dip
  // after the sell must not count — the position is closed.
  const result = replayPlan([window([88, 95], [81, 86], [100, 115], [50, 55])], PLAN);
  assert.equal(result.exitAfterEntryRate, 1);
  assert.ok(Math.abs(result.medianAdverseMove - -0.1) < 1e-9, `got ${result.medianAdverseMove}`);
});

test("rates are aggregated over every window, fill rate and hit rate separately", () => {
  const result = replayPlan(
    [
      window([88, 95], [100, 115]), // buys, then sells
      window([88, 95], [92, 99]), // buys, never sells
      window([95, 99], [96, 98]), // never buys
      window([95, 130]), // spike above the sell with no buy — the old false positive
    ],
    PLAN,
  );
  assert.equal(result.samples, 4);
  assert.equal(result.filled, 2);
  assert.equal(result.entryFillRate, 0.5);
  assert.equal(result.exitAfterEntryRate, 0.5, "one of the two that bought went on to sell");
});

test("the hour that sold cannot also contribute a drawdown", () => {
  // Hour 2 both dips to 45 (-50% against the 90 buy) and reaches the sell at
  // 115. With no ordering inside an hour, that dip may well have happened after
  // the sale — and a closed position cannot draw down. Counting it read as a
  // catastrophic dip on a trade that actually worked.
  const result = replayPlan([window([88, 95], [45, 115], [40, 50])], PLAN);
  assert.equal(result.exitAfterEntryRate, 1);
  assert.equal(result.medianAdverseMove, 0, "only hours strictly between buy and sell can draw down");
});

test("a dip strictly between the buy and the sell still counts", () => {
  const result = replayPlan([window([88, 95], [72, 95], [100, 115])], PLAN);
  assert.equal(result.exitAfterEntryRate, 1);
  assert.ok(Math.abs(result.medianAdverseMove - -0.2) < 1e-9, `got ${result.medianAdverseMove}`);
});
