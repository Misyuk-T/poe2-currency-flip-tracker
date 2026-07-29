import test from "node:test";
import assert from "node:assert/strict";

import { buildReachLadder, forwardWindows, priceForBuyReach } from "../apps/web/lib/reach-curve.js";

const HOUR = 3600_000;

/** Hourly points at a steady centre of 100, with the given low/high per hour. */
function series(...hours) {
  return hours.map(([low, high], i) => ({ completedHour: i * HOUR, low, high, reference: 100 }));
}

test("windows running past the end of the data are not counted as failures", () => {
  // Six hours of data at a 3h horizon: only the starts with three full hours
  // ahead of them can answer anything.
  const points = series([95, 105], [95, 105], [95, 105], [95, 105], [95, 105], [95, 105]);
  assert.equal(forwardWindows(points, 3).length, 3);
});

test("each window is measured against its own centre, not today's price", () => {
  // The market doubled halfway through. Measured in absolute prices the old half
  // would look like a permanent discount; in factors both halves say the same
  // thing — the low sits 5% under the centre.
  const points = [
    ...[0, 1, 2].map((i) => ({ completedHour: i * HOUR, low: 95, high: 105, reference: 100 })),
    ...[3, 4, 5].map((i) => ({ completedHour: i * HOUR, low: 190, high: 210, reference: 200 })),
  ];
  const ladder = buildReachLadder(points, { horizonHours: 1, basis: 200, levelCount: 21 });
  const nearBasis = ladder.levels.find((level) => level.price >= 190);
  assert.ok(nearBasis.buyReach > 0.5, "a 5% dip should read as common in both regimes");
});

test("the buy curve is monotone: a lower price is never reached more often", () => {
  const points = series([98, 102], [90, 110], [80, 120], [95, 105], [70, 130], [99, 101], [85, 115], [92, 108]);
  const ladder = buildReachLadder(points, { horizonHours: 2, basis: 100 });
  for (let i = 1; i < ladder.levels.length; i += 1) {
    assert.ok(
      ladder.levels[i].buyReach >= ladder.levels[i - 1].buyReach,
      `buy reach fell from ${ladder.levels[i - 1].buyReach} to ${ladder.levels[i].buyReach} as the price rose`,
    );
  }
});

test("a sell only counts once the buy happened, and only with an hour left after it", () => {
  // Every third hour spikes to 130 while the price only reaches the 89 buy on
  // the hour before it. A window whose buy lands in its final hour has nothing
  // to sell into: it must be excluded, not scored as a plan that failed.
  const points = series(
    [90, 100], [88, 101], [95, 130], [90, 100], [88, 101], [95, 130],
    [90, 100], [88, 101], [95, 130], [90, 100], [88, 101], [95, 130],
  );
  const ladder = buildReachLadder(points, { horizonHours: 2, basis: 100, buyPrice: 89 });
  assert.ok(ladder.bought > ladder.observable, "windows that bought in their last hour must drop out");
  const high = ladder.levels.filter((level) => level.price >= 125);
  assert.ok(high.length && high.every((level) => level.sellReach > 0), "the 130 spikes did follow a buy");
  for (const level of ladder.levels) {
    if (level.sellReach == null) continue;
    assert.ok(level.sellReach >= 0 && level.sellReach <= 1);
  }
});

test("with no buy price chosen there is no sell curve to draw", () => {
  const points = series(
    [95, 105], [90, 110], [92, 108], [94, 106], [96, 104], [93, 107], [91, 109], [97, 103],
  );
  const ladder = buildReachLadder(points, { horizonHours: 2, basis: 100 });
  assert.equal(ladder.observable, 0);
  assert.ok(ladder.levels.every((level) => level.sellReach === null));
});

test("a target can be stated as a reach share instead of an arbitrary quantile", () => {
  // This is the whole point: "a buy that fills in 80% of windows" is a claim a
  // trader can check, where "the 25th percentile of hourly lows" is not.
  const points = series(
    [98, 102], [90, 110], [80, 120], [95, 105], [70, 130], [99, 101], [85, 115], [92, 108],
    [97, 103], [88, 112], [82, 118], [93, 107],
  );
  const ladder = buildReachLadder(points, { horizonHours: 2, basis: 100 });
  const common = priceForBuyReach(ladder, 0.8);
  const rare = priceForBuyReach(ladder, 0.2);
  // Reach rises with price: a buy near the market fills constantly, a deep
  // discount rarely. So the one that fills more often is the DEARER of the two —
  // which is the trade-off the curve exists to make visible.
  assert.ok(common > rare, `a buy that fills more often must sit higher (${common} vs ${rare})`);
  assert.ok(rare < 100 && common < 100, "both are still discounts to the basis");
});

test("too little history yields nothing rather than a curve built on three windows", () => {
  assert.equal(buildReachLadder(series([95, 105], [96, 104]), { horizonHours: 1, basis: 100 }), null);
  assert.equal(buildReachLadder([], { horizonHours: 1, basis: 100 }), null);
  assert.equal(buildReachLadder(series([95, 105]), { horizonHours: 1, basis: 0 }), null);
});

test("the ladder answers from the same windows as the plan's replay", () => {
  // Drawn over the whole series while the plan replayed only its most recent 25
  // windows, the two disagreed on screen: "17% of 162 windows" beside "68% of
  // 25 windows", for the same price and the same question.
  const points = Array.from({ length: 200 }, (_, hour) => ({
    completedHour: hour * HOUR,
    reference: 100,
    // The market only became cheap in its final stretch, so a full-history
    // answer and a recent-history answer must differ — and the ladder has to
    // give the recent one.
    low: hour < 170 ? 99 : 80,
    high: 105,
  }));
  const ladder = buildReachLadder(points, { horizonHours: 2, basis: 100, levelCount: 21 });
  assert.equal(ladder.windows, 25, "the ladder must not reach further back than the plan does");
  const cheap = ladder.levels.find((level) => level.price <= 85);
  assert.ok(cheap.buyReach > 0.5, "the recent regime should dominate, as it does in the plan");
});

test("the readout reports the plan's exact price, not the nearest rung", () => {
  const points = Array.from({ length: 60 }, (_, hour) => ({
    completedHour: hour * HOUR,
    reference: 100,
    low: hour % 2 === 0 ? 90 : 97,
    high: 105,
  }));
  const ladder = buildReachLadder(points, { horizonHours: 2, basis: 100, buyPrice: 90, sellPrice: 104 });
  // Every window contains an even hour, so a buy at 90 is reached in all of them.
  assert.equal(ladder.atPlan.buyReach, 1);
  assert.ok(ladder.atPlan.sellReach > 0);
  assert.equal(buildReachLadder(points, { horizonHours: 2, basis: 100 }).atPlan.buyReach, null);
});
