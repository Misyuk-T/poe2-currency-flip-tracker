import test from "node:test";
import assert from "node:assert/strict";

import { buildTrendRows } from "../apps/web/lib/chart-series.js";

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
