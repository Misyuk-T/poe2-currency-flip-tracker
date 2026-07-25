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

function randomInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

/**
 * A stack size that stays plausible for the item's worth: cheap orbs pile up,
 * expensive ones don't (no 3,000 Mirrors of Kalandra).
 *
 * Sizes are derived from a target WORTH drawn log-uniformly across a wide
 * range, rather than from the unit price directly. That deliberately spreads
 * holdings across the whole value spectrum, so the "best paid in" answer
 * genuinely varies — a few exalted of junk can only be taken in exalted, while
 * a big stack is cheapest taken in divine.
 */
const MIN_HOLDING_EX = 3;
const MAX_HOLDING_EX = 4000;

function plausibleStack(exaltedEach) {
  if (!Number.isFinite(exaltedEach) || exaltedEach <= 0) return randomInt(1, 20);
  const logMin = Math.log(MIN_HOLDING_EX);
  const targetWorth = Math.exp(logMin + Math.random() * (Math.log(MAX_HOLDING_EX) - logMin));
  return Math.max(1, Math.round(targetWorth / exaltedEach));
}

/**
 * Mocked shape of one `account:characters` character's currency-frame
 * inventory. Deliberately RANDOM on every call (unlike the deterministic
 * league/ladder mocks above) so it's visibly obvious on repeat use that
 * this is a fake demo character, not a real, stable account read.
 *
 * `pool` should be the live radar's tradable rows — passing them in means the
 * demo shows REAL item names, icons and prices, with only the quantities
 * invented. Falls back to the three anchors when no pool is available.
 *
 * @param {string} league
 * @param {{ pool?: Array<{id: string, name?: string, icon?: string, exaltedEach?: number}>, count?: number }} [opts]
 */
export function mockCharacterInventory(league, { pool = [], count = 7 } = {}) {
  const usable = pool.filter((entry) => entry?.id && Number.isFinite(entry.exaltedEach) && entry.exaltedEach > 0);
  let picks;
  if (usable.length) {
    // Sample without replacement so the same orb never appears twice.
    const remaining = [...usable];
    picks = [];
    while (picks.length < Math.min(count, remaining.length)) {
      picks.push(...remaining.splice(randomInt(0, remaining.length - 1), 1));
    }
  } else {
    picks = [
      { id: "exalted", exaltedEach: 1 },
      { id: "chaos", exaltedEach: null },
      { id: "divine", exaltedEach: null },
    ];
  }

  return {
    name: "DemoWarbringer",
    class: "Warbringer",
    level: randomInt(40, 100),
    league,
    currency: picks.map((entry) => ({
      id: entry.id,
      name: entry.name ?? null,
      icon: entry.icon ?? null,
      exaltedEach: entry.exaltedEach ?? null,
      stackSize: plausibleStack(entry.exaltedEach),
    })),
    mocked: true,
  };
}

/**
 * Price a mocked currency stack list against real, currently-live CX rates.
 * A stack whose id has no live rate prices as `null` rather than a guess —
 * same honesty rule as the rest of price-guidance.js.
 *
 * Items carrying their own live `exaltedEach` (sampled from the radar) price
 * directly off it; the three anchors fall back to the `rates` conversion.
 */
export function valueInventoryInExalted(items, rates) {
  const priced = (items ?? []).map((item) => ({
    ...item,
    exaltedValue: Number.isFinite(item.exaltedEach) && item.exaltedEach > 0
      ? item.stackSize * item.exaltedEach
      : convertMarketPrice(item.stackSize, item.id, "exalted", rates),
  }));
  const known = priced.filter((item) => Number.isFinite(item.exaltedValue));
  return {
    items: priced,
    totalExalted: known.length ? known.reduce((sum, item) => sum + item.exaltedValue, 0) : null,
  };
}
