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

test("buildTrendRows exposes the real observed band, not a fabricated open/close", () => {
  const { rows } = buildTrendRows([
    banded(1, 5, 4, 6),
    banded(2, 7, 3, 9),
  ], 6);

  assert.equal(rows.length, 1);
  const { range } = rows[0];
  // Widest low and highest high actually seen in the window.
  assert.equal(range.low, 3);
  assert.equal(range.high, 9);
  // The box spans exactly that band: no invented open/close, so no wick.
  assert.equal(range.open, range.low);
  assert.equal(range.close, range.high);
});

test("range bars colour by the median's direction against the previous window", () => {
  const { rows } = buildTrendRows([
    banded(1, 10, 9, 11),
    banded(2, 4, 3, 5),
    banded(3, 20, 19, 21),
  ], 1);

  assert.equal(rows[0].range.color, UP_COLOR); // first window has no prior -> treated as up
  assert.equal(rows[1].range.color, DOWN_COLOR); // 10 -> 4
  assert.equal(rows[2].range.color, UP_COLOR); // 4 -> 20
});

test("an hour with no usable band falls back to its midpoint rather than vanishing", () => {
  const { rows } = buildTrendRows([point(1, 8), point(2, 12)], 6);
  assert.equal(rows[0].range.low, 8);
  assert.equal(rows[0].range.high, 12);
});
