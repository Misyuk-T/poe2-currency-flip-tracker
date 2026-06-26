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
const FAR_FUTURE = 1000 * HOUR;
const candle = (h, low, high, reference) => ({
  completedHour: h * HOUR,
  low,
  high,
  reference,
  target: "divine",
  anchor: "exalted",
});

test("a filled take-profit closes with the spread as realised profit", () => {
  const series = [candle(1, 98, 105, 101), candle(2, 102, 112, 108)];
  const r = evaluatePaperTrade(
    { entryHour: 0, entryPrice: 100, targetExit: 110, horizonHours: 6, size: 2 },
    series,
    { now: FAR_FUTURE },
  );
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

test("a never-reached entry is missed (no position, zero profit) once the horizon elapses", () => {
  const series = [candle(1, 101, 108, 104), candle(2, 102, 109, 105)];
  const r = evaluatePaperTrade(
    { entryHour: 0, entryPrice: 90, targetExit: 120, horizonHours: 6 },
    series,
    { now: FAR_FUTURE },
  );
  assert.equal(r.status, "entry-missed");
  assert.equal(r.filled, false);
  assert.equal(r.profit, 0);
});

test("a filled trade whose target never prints is marked to market at the horizon (losses surface here)", () => {
  const series = [candle(1, 99, 105, 102), candle(2, 95, 101, 97)];
  const r = evaluatePaperTrade(
    { entryHour: 0, entryPrice: 100, targetExit: 120, horizonHours: 2, size: 1 },
    series,
    { now: FAR_FUTURE },
  );
  assert.equal(r.status, "open-at-horizon");
  assert.equal(r.marked, true);
  assert.equal(r.exitPrice, 97); // last reference
  assert.ok(Math.abs(r.profit - -3) < 1e-9); // a real simulated loss
  assert.ok(Math.abs(r.maeFactor - -0.05) < 1e-9); // worst low 95
});

test("before the horizon elapses the outcome stays pending/open — never a fabricated win or loss", () => {
  const series = [candle(1, 99, 105, 102)]; // filled, no target yet
  const open = evaluatePaperTrade(
    { entryHour: 0, entryPrice: 100, targetExit: 130, horizonHours: 6 },
    series,
    { now: 3 * HOUR },
  );
  assert.equal(open.status, "open");
  assert.equal(open.filled, true);
  assert.equal(open.profit, null);

  const noFill = evaluatePaperTrade(
    { entryHour: 0, entryPrice: 80, targetExit: 130, horizonHours: 6 },
    series,
    { now: 3 * HOUR },
  );
  assert.equal(noFill.status, "pending");
  assert.equal(noFill.filled, false);

  const noData = evaluatePaperTrade(
    { entryHour: 0, entryPrice: 100, targetExit: 130, horizonHours: 6 },
    [],
    { now: FAR_FUTURE },
  );
  assert.equal(noData.status, "no-data");
});

test("a target hit early closes even if the horizon has not elapsed", () => {
  const series = [candle(1, 99, 131, 120)];
  const r = evaluatePaperTrade(
    { entryHour: 0, entryPrice: 100, targetExit: 130, horizonHours: 6 },
    series,
    { now: 2 * HOUR },
  );
  assert.equal(r.status, "closed");
  assert.equal(r.profit, 30);
});

test("gold efficiency uses the round-trip cost", () => {
  const series = [candle(1, 98, 112, 105)];
  const r = evaluatePaperTrade(
    { entryHour: 0, entryPrice: 100, targetExit: 110, horizonHours: 6, size: 2, goldPerTarget: 1000, goldPerAnchor: 0.5 },
    series,
    { now: FAR_FUTURE },
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

test("summarizePaperTrades counts only resolved trades and computes honest rates", () => {
  const win = evaluatePaperTrade({ entryHour: 0, entryPrice: 100, targetExit: 110, horizonHours: 6 }, [candle(1, 98, 112, 108)], { now: FAR_FUTURE });
  const missed = evaluatePaperTrade({ entryHour: 0, entryPrice: 90, targetExit: 120, horizonHours: 6 }, [candle(1, 101, 108, 104)], { now: FAR_FUTURE });
  const loss = evaluatePaperTrade({ entryHour: 0, entryPrice: 100, targetExit: 120, horizonHours: 2 }, [candle(1, 99, 105, 97)], { now: FAR_FUTURE });
  const pending = evaluatePaperTrade({ entryHour: 0, entryPrice: 100, targetExit: 130, horizonHours: 6 }, [candle(1, 99, 105, 102)], { now: 3 * HOUR });

  const s = summarizePaperTrades([win, missed, loss, pending]);
  assert.equal(s.evaluated, 3); // pending excluded
  assert.equal(s.pending, 1);
  assert.equal(s.taken, 2); // win + loss filled; missed not filled
  assert.equal(s.closed, 1);
  assert.equal(s.openAtHorizon, 1);
  assert.equal(s.entryMissed, 1);
  assert.ok(Math.abs(s.fillRate - 2 / 3) < 1e-9);
  assert.equal(s.winRate, 0.5); // one of two taken was profitable
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
  const latest = Math.max(...series.map((c) => c.completedHour));

  const bt = backtestRecommendations({ series, horizonHours: 6, now: latest + 6 * HOUR });
  assert.ok(bt.results.length > 0, "produced recommendations");
  assert.ok(bt.summary.evaluated > 0, "evaluated resolved trades");
  // Only the trailing hours that have no future candles within the horizon stay
  // unresolved — the bulk resolves once `now` is past the last horizon.
  assert.ok(bt.summary.evaluated >= bt.summary.pending, "the bulk resolves");
  assert.ok(bt.summary.evaluated >= bt.results.length - 2, "only a small tail can lack forward data");
  assert.ok(bt.summary.fillRate >= 0 && bt.summary.fillRate <= 1);
  if (bt.summary.winRate != null) assert.ok(bt.summary.winRate >= 0 && bt.summary.winRate <= 1);
});
