import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluatePaperTrade,
  summarizePaperTrades,
  medianFactorRecommender,
  backtestRecommendations,
} from "../src/domain/paper-trade.js";
import { buildCxapiFixtures } from "../src/data/fixtures/cxapi-fixtures.js";
import { normalizeCxDigest, candleForAnchor } from "../src/domain/cx-market.js";

const HOUR = 3600_000;
const candle = (h, low, high, reference) => ({
  completedHour: h * HOUR,
  low,
  high,
  reference,
  target: "divine",
  anchor: "exalted",
});

test("a take-profit hit in a later hour closes with the spread as realised profit", () => {
  const series = [candle(1, 98, 105, 101), candle(2, 102, 112, 108)];
  const r = evaluatePaperTrade({ entryHour: 0, entryPrice: 100, targetExit: 110, horizonHours: 6, size: 2 }, series);
  assert.equal(r.status, "closed");
  assert.equal(r.filled, true);
  assert.equal(r.marked, false);
  assert.equal(r.fillHour, 1 * HOUR);
  assert.equal(r.exitHour, 2 * HOUR);
  assert.equal(r.exitPrice, 110);
  assert.equal(r.profit, 20); // 2 * (110 - 100)
  assert.ok(Math.abs(r.profitPct - 0.1) < 1e-9);
  assert.equal(r.holdingHours, 1);
  assert.ok(Math.abs(r.maeFactor - -0.02) < 1e-9); // worst low 98 vs entry 100
});

test("a same-hour fill+target is NOT credited as a win (intrahour order is unknowable)", () => {
  // One candle whose low reaches the entry AND whose high reaches the target.
  const r = evaluatePaperTrade({ entryHour: 0, entryPrice: 100, targetExit: 130, horizonHours: 6 }, [candle(1, 99, 131, 120)]);
  assert.notEqual(r.status, "closed");
  assert.equal(r.status, "open"); // filled, target not provable, horizon not yet covered
  assert.equal(r.profit, null);
});

test("a target hit in a later hour closes even before the full horizon is observed", () => {
  const series = [candle(1, 99, 105, 102), candle(2, 100, 131, 120)];
  const r = evaluatePaperTrade({ entryHour: 0, entryPrice: 100, targetExit: 130, horizonHours: 6 }, series);
  assert.equal(r.status, "closed");
  assert.equal(r.profit, 30);
});

test("a never-reached entry is missed only once the horizon is fully observed", () => {
  const covered = [candle(1, 101, 108, 104), candle(2, 102, 109, 105)];
  const r = evaluatePaperTrade({ entryHour: 0, entryPrice: 90, targetExit: 120, horizonHours: 2 }, covered);
  assert.equal(r.status, "entry-missed");
  assert.equal(r.filled, false);
  assert.equal(r.profit, 0);

  // Same setup but the horizon isn't covered by data yet → pending, not missed.
  const pending = evaluatePaperTrade({ entryHour: 0, entryPrice: 90, targetExit: 120, horizonHours: 6 }, covered);
  assert.equal(pending.status, "pending");
});

test("a filled trade whose target never prints is marked to market at the horizon (losses surface here)", () => {
  const series = [candle(1, 99, 105, 102), candle(2, 95, 101, 97)];
  const r = evaluatePaperTrade({ entryHour: 0, entryPrice: 100, targetExit: 120, horizonHours: 2, size: 1 }, series);
  assert.equal(r.status, "open-at-horizon");
  assert.equal(r.marked, true);
  assert.equal(r.exitPrice, 97); // last reference
  assert.ok(Math.abs(r.profit - -3) < 1e-9); // a real simulated loss
  assert.ok(Math.abs(r.maeFactor - -0.05) < 1e-9); // worst low 95
});

test("an uncovered horizon stays pending/open — never a fabricated win or loss", () => {
  const open = evaluatePaperTrade({ entryHour: 0, entryPrice: 100, targetExit: 130, horizonHours: 6 }, [candle(1, 99, 105, 102)]);
  assert.equal(open.status, "open");
  assert.equal(open.filled, true);
  assert.equal(open.profit, null);

  const noFill = evaluatePaperTrade({ entryHour: 0, entryPrice: 80, targetExit: 130, horizonHours: 6 }, [candle(1, 99, 105, 102)]);
  assert.equal(noFill.status, "pending");
  assert.equal(noFill.filled, false);

  // Covered window but a gap leaves nothing inside it → no-data, not invented.
  const gap = evaluatePaperTrade({ entryHour: 0, entryPrice: 100, targetExit: 110, horizonHours: 2 }, [candle(3, 99, 112, 105)]);
  assert.equal(gap.status, "no-data");
});

test("gold efficiency uses the round-trip cost", () => {
  const series = [candle(1, 98, 105, 101), candle(2, 102, 112, 108)];
  const r = evaluatePaperTrade(
    { entryHour: 0, entryPrice: 100, targetExit: 110, horizonHours: 6, size: 2, goldPerTarget: 1000, goldPerAnchor: 0.5 },
    series,
  );
  assert.equal(r.status, "closed");
  // entryGold = ceil(2 * 1000) = 2000; exitGold = ceil(2*110 * 0.5) = 110; total = 2110
  assert.equal(r.totalGold, 2110);
  assert.ok(Math.abs(r.profitPer100kGold - (20 / 2110) * 100_000) < 1e-6);
});

test("invalid trades are rejected, not silently scored", () => {
  assert.equal(evaluatePaperTrade({ entryHour: 0, entryPrice: 100, targetExit: 100 }, []).status, "invalid");
  assert.equal(evaluatePaperTrade({ entryPrice: 100, targetExit: 110 }, []).status, "invalid");
});

test("summarizePaperTrades separates take-profit hits from merely-profitable outcomes", () => {
  const win = evaluatePaperTrade({ entryHour: 0, entryPrice: 100, targetExit: 110, horizonHours: 6 }, [candle(1, 98, 105, 101), candle(2, 102, 112, 108)]);
  const missed = evaluatePaperTrade({ entryHour: 0, entryPrice: 90, targetExit: 120, horizonHours: 2 }, [candle(1, 101, 108, 104), candle(2, 102, 109, 105)]);
  const loss = evaluatePaperTrade({ entryHour: 0, entryPrice: 100, targetExit: 120, horizonHours: 2 }, [candle(1, 99, 105, 102), candle(2, 95, 101, 97)]);
  const pending = evaluatePaperTrade({ entryHour: 0, entryPrice: 100, targetExit: 130, horizonHours: 6 }, [candle(1, 99, 105, 102)]);

  const s = summarizePaperTrades([win, missed, loss, pending]);
  assert.equal(s.evaluated, 3); // pending excluded
  assert.equal(s.pending, 1);
  assert.equal(s.taken, 2); // win + loss filled; missed not filled
  assert.equal(s.closed, 1);
  assert.equal(s.openAtHorizon, 1);
  assert.equal(s.entryMissed, 1);
  assert.ok(Math.abs(s.fillRate - 2 / 3) < 1e-9);
  assert.equal(s.tpHitRate, 0.5); // 1 of 2 filled actually hit the target
  assert.equal(s.profitableRate, 0.5); // 1 of 2 filled ended green
  assert.ok(Math.abs(s.avgProfit - (10 + -3) / 2) < 1e-9);
});

test("medianFactorRecommender needs trailing history and yields entry < exit", () => {
  const rec = medianFactorRecommender({ lookback: 24, minSamples: 3 });
  assert.equal(rec([], { reference: 100 }), null);
  const history = [candle(1, 90, 110, 100), candle(2, 92, 108, 100), candle(3, 88, 112, 100)];
  const out = rec(history, { reference: 100 });
  assert.ok(out && out.entryPrice > 0 && out.targetExit > out.entryPrice);
});

test("backtestRecommendations replays over real fixture candles and summarises honestly", () => {
  const byPair = {};
  for (const d of buildCxapiFixtures({ league: "L" })) {
    for (const c of normalizeCxDigest(d.payload, { digestId: d.digestId, league: "L" }).candles) {
      (byPair[c.pairId] ??= []).push(c);
    }
  }
  const pair = Object.values(byPair).find((cs) => cs.some((c) => c.base === "divine" || c.quote === "divine"));
  const series = pair.map((c) => candleForAnchor(c, "divine", "exalted")).filter(Boolean);

  const bt = backtestRecommendations({ series, horizonHours: 6 });
  assert.ok(bt.results.length > 0, "produced recommendations");
  assert.ok(bt.summary.evaluated > 0, "evaluated resolved trades");
  // The trailing hours within a horizon of the last candle have no full future
  // window and honestly stay pending — they must not inflate the resolved set.
  assert.ok(bt.summary.pending >= 0);
  assert.ok(bt.summary.evaluated + bt.summary.pending === bt.results.length);
  assert.ok(bt.summary.fillRate >= 0 && bt.summary.fillRate <= 1);
  if (bt.summary.tpHitRate != null) assert.ok(bt.summary.tpHitRate >= 0 && bt.summary.tpHitRate <= 1);
});
