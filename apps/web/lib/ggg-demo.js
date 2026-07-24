/**
 * Mocked GGG OAuth data (service:leagues, service:leagues:ladder,
 * account:characters) for the T1-T9 feature demos in docs/BACKLOG.md.
 *
 * NONE of this calls a real GGG endpoint — the OAuth scopes it depends on are
 * not approved yet (see docs/BACKLOG.md "GGG OAuth features" T1). Every value
 * here is a deterministic function of the league name, so a demo looks stable
 * across renders without needing a backend. Swap these functions for real
 * `service:leagues` / `service:leagues:ladder` / `account:characters` fetches
 * once T1/T2 land — callers should not need to change shape.
 */

import { convertMarketPrice } from "./price-guidance.js";

const DAY_MS = 86_400_000;
const SEASON_DAYS = 91;

/** Stable [0,1) pseudo-random value from a string, so demo data doesn't jump around. */
function hashSeed(input) {
  let h = 2166136261;
  const text = String(input);
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/** Mocked shape of a `service:leagues` entry, plus a day-number/countdown. */
export function mockLeagueMeta(league, { now = Date.now() } = {}) {
  const seed = hashSeed(league);
  const dayNumber = 4 + Math.floor(seed * 40); // 4..43
  const daysRemaining = Math.max(1, SEASON_DAYS - dayNumber);
  const startAt = now - dayNumber * DAY_MS;
  const endAt = startAt + SEASON_DAYS * DAY_MS;
  return { league, category: "Challenge League", dayNumber, daysRemaining, startAt, endAt, mocked: true };
}

function medianLevelForDay(dayNumber) {
  return Math.max(1, Math.min(100, Math.round(30 + dayNumber * 5)));
}

const LADDER_BUCKETS = [
  { label: "1-20", from: 1, to: 20 },
  { label: "21-40", from: 21, to: 40 },
  { label: "41-60", from: 41, to: 60 },
  { label: "61-80", from: 61, to: 80 },
  { label: "81-100", from: 81, to: 100 },
];

/**
 * Mocked descriptive aggregate of a `service:leagues:ladder` top-1000 pull —
 * median level, growth rate, and a level-bucket distribution. Deliberately
 * descriptive only (see docs/BACKLOG.md T6/T7): a real maturity "signal"
 * ships only once real snapshots are backtested against real CX volatility.
 */
export function mockLadderSnapshot(league, { now = Date.now(), dayNumber } = {}) {
  const day = dayNumber ?? mockLeagueMeta(league, { now }).dayNumber;
  const medianLevel = medianLevelForDay(day);
  const priorMedianLevel = medianLevelForDay(Math.max(1, day - 1));
  const levelsPerDay = Math.max(0, medianLevel - priorMedianLevel);
  const seed = hashSeed(`${league}:ladder`);
  const totalEntries = 1000;
  const deadCount = Math.round(totalEntries * (0.03 + seed * 0.06));
  const weighted = LADDER_BUCKETS.map((bucket) => {
    const mid = (bucket.from + bucket.to) / 2;
    const distance = Math.abs(mid - medianLevel);
    return { ...bucket, weight: Math.max(0.05, 1 - distance / 60) };
  });
  const weightSum = weighted.reduce((sum, bucket) => sum + bucket.weight, 0);
  const distribution = weighted.map((bucket) => ({
    label: bucket.label,
    count: Math.round((bucket.weight / weightSum) * totalEntries),
  }));
  return { league, fetchedAt: now, dayNumber: day, totalEntries, medianLevel, levelsPerDay, deadCount, distribution, mocked: true };
}

/** Mocked shape of one `account:characters` character's currency-frame inventory. */
export function mockCharacterInventory(league) {
  const seed = hashSeed(`${league}:character`);
  return {
    name: "DemoWarbringer",
    class: "Warbringer",
    level: 62 + Math.round(seed * 30),
    league,
    currency: [
      { id: "exalted", stackSize: 120 + Math.round(seed * 300) },
      { id: "chaos", stackSize: 800 + Math.round(seed * 1200) },
      { id: "divine", stackSize: 2 + Math.round(seed * 8) },
    ],
    mocked: true,
  };
}

/**
 * Price a mocked currency stack list against real, currently-live CX rates.
 * A stack whose id has no live rate prices as `null` rather than a guess —
 * same honesty rule as the rest of price-guidance.js.
 */
export function valueInventoryInExalted(items, rates) {
  const priced = (items ?? []).map((item) => ({
    ...item,
    exaltedValue: convertMarketPrice(item.stackSize, item.id, "exalted", rates),
  }));
  const known = priced.filter((item) => Number.isFinite(item.exaltedValue));
  return {
    items: priced,
    totalExalted: known.length ? known.reduce((sum, item) => sum + item.exaltedValue, 0) : null,
  };
}
