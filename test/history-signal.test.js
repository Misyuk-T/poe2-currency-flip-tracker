import { test } from "node:test";
import assert from "node:assert/strict";

import { computeHistorySignal, horizonAdjustment } from "../src/domain/history-signal.js";

const HOUR = 3600_000;
const NOW = 10 * HOUR;

function rising(target, perHour, hours, stepMin = 30) {
  const pts = [];
  for (let t = NOW - hours * HOUR; t <= NOW; t += stepMin * 60_000) {
    pts.push({ t, target, spreadPct: ((t - (NOW - hours * HOUR)) / HOUR) * perHour });
  }
  return pts;
}

test("insufficient real history returns insufficient-history with null metrics (never fabricated)", () => {
  const sig = computeHistorySignal([{ t: NOW, target: "divine", spreadPct: 5 }], { now: NOW, horizonHours: 1 });
  assert.equal(sig.status, "insufficient-history");
  assert.equal(sig.spreadMomentumPctPerHour, null);
  assert.equal(sig.spreadVolatility, null);
});

test("momentum reflects the spread trend over the window", () => {
  const sig = computeHistorySignal(rising("divine", 2, 6), { now: NOW, horizonHours: 6 });
  assert.equal(sig.status, "ok");
  assert.ok(Math.abs(sig.spreadMomentumPctPerHour - 2) < 1e-6); // +2pp/hour
  assert.ok(sig.samples >= 3);
});

test("horizon materially changes the window (and thus the signal)", () => {
  const pts = rising("divine", 2, 6);
  const s1 = computeHistorySignal(pts, { now: NOW, horizonHours: 1 });
  const s6 = computeHistorySignal(pts, { now: NOW, horizonHours: 6 });
  assert.ok(s1.samples < s6.samples); // 1h window sees fewer points than 6h
});

test("synthetic provenance is carried through, never hidden", () => {
  const pts = rising("divine", 1, 3).map((p) => ({ ...p, synthetic: true }));
  const sig = computeHistorySignal(pts, { now: NOW, horizonHours: 3 });
  assert.equal(sig.synthetic, true);
});

test("Codex #4: three samples over ten minutes are insufficient for a 6h horizon", () => {
  // Plenty of samples (well above minSamples) but clustered into a 10-minute
  // slice — they cannot honestly describe a 6-hour horizon.
  const pts = [];
  for (let t = NOW - 10 * 60_000; t <= NOW; t += 5 * 60_000) {
    pts.push({ t, target: "divine", spreadPct: 5 });
  }
  const sig = computeHistorySignal(pts, { now: NOW, horizonHours: 6 });
  assert.equal(sig.status, "insufficient-history");
  assert.ok(sig.samples >= 3); // not a sample-count problem
  assert.ok(sig.spanHours < 0.2); // ~10 minutes
  assert.ok(sig.coverageFraction < 0.5);
  assert.equal(sig.meanSpreadPct, null); // metrics never fabricated under-coverage
});

test("Codex #4: the same short span IS sufficient for a matching short horizon", () => {
  const pts = [];
  for (let t = NOW - 10 * 60_000; t <= NOW; t += 2 * 60_000) {
    pts.push({ t, target: "divine", spreadPct: 5 });
  }
  // 10 minutes covers most of a ~12-minute (0.2h) horizon.
  const sig = computeHistorySignal(pts, { now: NOW, horizonHours: 0.2 });
  assert.equal(sig.status, "ok");
  assert.ok(sig.coverageFraction >= 0.5);
});

test("Codex #4: span/coverage are reported on an ok signal", () => {
  const sig = computeHistorySignal(rising("divine", 2, 6), { now: NOW, horizonHours: 6 });
  assert.equal(sig.status, "ok");
  assert.ok(Math.abs(sig.spanHours - 6) < 1e-6);
  assert.ok(Math.abs(sig.coverageFraction - 1) < 1e-6);
});

test("horizonAdjustment is 1 when no usable signal, bounded otherwise", () => {
  assert.equal(horizonAdjustment(null), 1);
  assert.equal(horizonAdjustment({ status: "insufficient-history" }), 1);
  const adj = horizonAdjustment({ status: "ok", spreadMomentumPctPerHour: 100, spreadVolatility: 0 });
  assert.ok(adj <= 1.4 && adj >= 0.6);
});
