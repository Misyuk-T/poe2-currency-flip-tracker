import test from "node:test";
import assert from "node:assert/strict";

import { buildTrendRows, UP_COLOR, DOWN_COLOR } from "../apps/web/lib/chart-series.js";

const HOUR = 3_600_000;

function point(hour, reference, targetVolume = 1) {
  return {
    completedHour: hour * HOUR,
    reference,
    target: "item",
    base: "item",
    volume: { item: targetVolume },
  };
}

test("buildTrendRows uses the median midpoint instead of an extreme 6h wick", () => {
  const { rows, bucketHours } = buildTrendRows([
    point(1, 4),
    point(2, 5),
    point(3, 34),
    point(4, 5),
    point(5, 4),
    point(6, 6),
  ], 6);

  assert.equal(bucketHours, 6);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].line.value, 5);
  assert.equal(rows[0].volume.value, 6);
  assert.equal(rows[0].samples, 6);
});

test("buildTrendRows preserves hourly midpoint points at the 1h view", () => {
  const { rows } = buildTrendRows([
    point(1, 4),
    point(2, 34),
    point(3, 5),
  ], 1);

  assert.deepEqual(rows.map((row) => row.line.value), [4, 34, 5]);
});

function banded(hour, reference, low, high, targetVolume = 1) {
  return { ...point(hour, reference, targetVolume), low, high };
}

test("the wick is every price touched; the body is the net move inside the window", () => {
  const { rows } = buildTrendRows([
    banded(1, 5, 4, 6),
    banded(2, 7, 3, 9),
  ], 6);

  assert.equal(rows.length, 1);
  const { range } = rows[0];
  // Wick: the widest low and highest high actually seen in the window.
  assert.equal(range.low, 3);
  assert.equal(range.high, 9);
  // Body: first and last hourly midpoint. Both observed values — not GGG's
  // opening and closing trades, which the feed does not carry. Previously the
  // body spanned the whole band, so a wide market drew one enormous block and
  // the wick was invisible inside it.
  assert.equal(range.open, 5);
  assert.equal(range.close, 7);
  assert.ok(range.open > range.low && range.close < range.high, "the body sits inside the wick");
});

test("a body edge can never escape the wick it is drawn inside", () => {
  // An hour whose midpoint sits outside the band it reports (a partial or
  // inconsistent record) must not draw a body sticking out of its own range.
  const { rows } = buildTrendRows([
    banded(1, 50, 4, 6),
    banded(2, 1, 3, 9),
  ], 6);
  const { range } = rows[0];
  assert.ok(range.open <= range.high && range.open >= range.low);
  assert.ok(range.close <= range.high && range.close >= range.low);
});

test("candles colour by their own body, not against the previous window", () => {
  const { rows } = buildTrendRows([
    banded(1, 10, 9, 11),
    banded(2, 12, 3, 13),
    banded(3, 8, 7, 21),
    banded(4, 6, 5, 9),
  ], 2);

  // Bucket one: 10 -> 12 rose. Bucket two: 8 -> 6 fell. Colour now describes
  // what happened inside the candle, which is what its shape already shows.
  assert.equal(rows[0].range.color, UP_COLOR);
  assert.equal(rows[1].range.color, DOWN_COLOR);
});

test("a single-hour bucket collapses the body to a line, having no move to show", () => {
  const { rows } = buildTrendRows([banded(1, 10, 9, 11)], 1);
  assert.equal(rows[0].range.open, rows[0].range.close);
  assert.equal(rows[0].range.low, 9);
  assert.equal(rows[0].range.high, 11);
});

test("an hour with no usable band falls back to its midpoint rather than vanishing", () => {
  const { rows } = buildTrendRows([point(1, 8), point(2, 12)], 6);
  assert.equal(rows[0].range.low, 8);
  assert.equal(rows[0].range.high, 12);
});
