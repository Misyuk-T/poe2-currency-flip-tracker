import test from "node:test";
import assert from "node:assert/strict";

import { buildTrendRows, readablePriceRange, UP_COLOR, DOWN_COLOR } from "../apps/web/lib/chart-series.js";

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

test("the wick is the window's typical hourly band; the body is the net move", () => {
  const { rows } = buildTrendRows([
    banded(1, 5, 4, 6),
    banded(2, 7, 3, 9),
  ], 6);

  assert.equal(rows.length, 1);
  const { range } = rows[0];
  // Wick: the 25th percentile of the hourly lows to the 75th of the highs — not
  // the outright min and max, which on a wide market ran every wick the full
  // height of the pane and told the reader nothing.
  assert.equal(range.low, 3.25);
  assert.equal(range.high, 8.25);
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
  assert.equal(rows[0].range.low, 9);
  assert.equal(rows[0].range.high, 11);
});

test("a single hour keeps its own reported band, unsmoothed", () => {
  // With one observation there is no distribution to take a quantile of, so the
  // hour must still show exactly what GGG reported for it.
  const { rows } = buildTrendRows([banded(1, 40, 1, 65), banded(2, 40, 30, 60)], 1);
  assert.equal(rows[0].range.low, 1);
  assert.equal(rows[0].range.high, 65);
});

test("one collapsed hour no longer stretches its whole bucket's wick", () => {
  // Chaos Orb: roughly one hour in seven reports a low near zero, so every
  // six-hour bucket contained one and every wick ran the full height of the
  // pane, identical to the next.
  const points = Array.from({ length: 36 }, (_, hour) =>
    banded(hour, 40, hour % 7 === 0 ? 1 : 30 + (hour % 5), 60 + (hour % 4)),
  );
  const { rows } = buildTrendRows(points, 6);
  const spans = rows.slice(1).map((row) => row.range.high - row.range.low);
  for (const span of spans) assert.ok(span < 40, `wick span ${span} is still swallowed by the outlier`);
  assert.ok(new Set(spans.map((s) => s.toFixed(1))).size > 1, "wicks must vary between buckets");
});

test("the axis frames the price when the wicks are hopeless", () => {
  // Chaos Orb, real production shape: hourly ranges like low 1 / high 65 around
  // a midpoint near 40, and 15% of hours look like that — far too many to call a
  // stray print and trim off as a tail.
  const points = Array.from({ length: 24 }, (_, hour) => {
    const reference = 40 + (hour % 6);
    return banded(hour, reference, hour % 7 === 0 ? 1 : reference - 12, reference + 22);
  });
  const { rows } = buildTrendRows(points, 6);
  const range = readablePriceRange(rows, [{ price: 38 }, { price: 57 }]);
  assert.ok(range, "a market whose wicks span two orders should be framed");
  assert.ok(range.minValue > 10, `min ${range.minValue} still chases the outlier low`);
  assert.ok(range.maxValue >= 57, "the sell target must stay in view");
});

test("plan levels are never pushed out of frame", () => {
  const points = Array.from({ length: 24 }, (_, hour) => banded(hour, 40, hour % 7 === 0 ? 1 : 38, 42));
  const { rows } = buildTrendRows(points, 6);
  const range = readablePriceRange(rows, [{ price: 12 }]);
  if (range) assert.ok(range.minValue <= 12, `buy target 12 fell outside ${range.minValue}`);
});

test("a market whose wicks already fit keeps plain autoscaling", () => {
  const { rows } = buildTrendRows(
    Array.from({ length: 24 }, (_, hour) => banded(hour, 48, 46 + (hour % 3), 50 + (hour % 3))),
    6,
  );
  assert.equal(readablePriceRange(rows, []), null);
});

test("too few candles to judge leaves the scale alone", () => {
  const { rows } = buildTrendRows([banded(1, 48, 1, 49), banded(2, 48, 47, 49)], 1);
  assert.equal(readablePriceRange(rows, []), null);
});
