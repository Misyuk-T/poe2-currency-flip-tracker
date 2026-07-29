/**
 * Empirical reach curves: how often the market came to a price, and how often it
 * came back after it did.
 *
 * This exists to replace a number nobody could justify. The buy and sell targets
 * were the 25th and 75th percentile of a window's hourly extremes — arithmetic
 * that is well defined but means nothing a trader can act on. "A quarter of the
 * hours dipped at least this low" is not a claim about your order. What follows
 * answers the question directly instead: pick a price, and read off the share of
 * past windows in which the market reached it.
 *
 * Two curves, because a flip is two events in order:
 *
 *   buyReach(p)  — share of windows where some hour's low came down to p.
 *   sellReach(p) — of the windows that bought at the chosen buy price AND had an
 *                  hour left afterwards, the share where a LATER hour's high
 *                  reached p.
 *
 * The sell curve is conditional on the buy for the same reason the replay is:
 * a high that happened before the price ever fell to your buy is not evidence
 * for the round trip. And the sell must land in a later hour, because GGG
 * publishes an hour's low and high with no ordering between them.
 *
 * Every window is measured in factors of its OWN starting centre, then rebased
 * onto the price you are looking at now. A week-old regime contributes its
 * shape, never its absolute prices.
 *
 * "Reached", never "filled": an hourly low arriving at a price means the market
 * traded there, not that your order cleared at your size.
 */

const DEFAULT_LEVELS = 41;
// Matches maxSamples in price-guidance.js: the two views must answer from the
// same evidence or they contradict each other in front of the user.
const DEFAULT_MAX_WINDOWS = 25;

function positive(value) {
  return Number.isFinite(value) && value > 0;
}

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/**
 * Forward windows whose whole horizon is present in the data. A window running
 * past the end of the series cannot say whether the plan worked; counted, it
 * would read as one that failed.
 */
export function forwardWindows(points, horizonHours) {
  const horizonMs = Math.max(1, Number(horizonHours) || 1) * 3600_000;
  const usable = (points ?? [])
    .filter((point) => positive(point?.reference) && positive(point?.low) && positive(point?.high))
    .sort((a, b) => (a.completedHour ?? 0) - (b.completedHour ?? 0));
  const lastTime = usable.at(-1)?.completedHour;
  const windows = [];
  for (let i = 0; i < usable.length - 1; i += 1) {
    const start = usable[i];
    const startTime = start.completedHour;
    if (!Number.isFinite(startTime) || !Number.isFinite(lastTime)) continue;
    if (lastTime < startTime + horizonMs) continue;
    const future = [];
    for (let j = i + 1; j < usable.length; j += 1) {
      const point = usable[j];
      if (point.completedHour <= startTime) continue;
      if (point.completedHour > startTime + horizonMs) break;
      future.push({ low: point.low / start.reference, high: point.high / start.reference });
    }
    if (future.length) windows.push(future);
  }
  return windows;
}

/**
 * @param {object[]} points hourly {completedHour, low, high, reference}
 * @param {{ horizonHours?: number, basis: number, buyPrice?: number, levelCount?: number }} opts
 * @returns {null | { levels: Array<{price:number, buyReach:number, sellReach:number|null}>,
 *                    windows:number, bought:number, observable:number, basis:number }}
 */
export function buildReachLadder(
  points,
  {
    horizonHours = 6,
    basis,
    buyPrice = null,
    sellPrice = null,
    levelCount = DEFAULT_LEVELS,
    maxWindows = DEFAULT_MAX_WINDOWS,
  } = {},
) {
  if (!positive(basis)) return null;
  // The SAME window set the plan's replay uses. Drawn over every window in the
  // series instead, the curve said 17% where the panel beside it said 68% — both
  // arithmetically correct, over different stretches of history, and flatly
  // contradictory on screen.
  const windows = forwardWindows(points, horizonHours).slice(-maxWindows);
  if (windows.length < 5) return null;

  const lowFactors = windows.map((future) => Math.min(...future.map((hour) => hour.low))).sort((a, b) => a - b);
  const highFactors = windows.map((future) => Math.max(...future.map((hour) => hour.high))).sort((a, b) => a - b);
  // Span the range the market actually reached, clipped at both ends so one
  // extreme window cannot stretch the ladder past the point of being readable.
  const floor = quantile(lowFactors, 0.05);
  const ceiling = quantile(highFactors, 0.95);
  if (!positive(floor) || !positive(ceiling) || !(ceiling > floor)) return null;

  const buyFactor = positive(buyPrice) ? buyPrice / basis : null;
  const fills = windows.map((future) => {
    if (!positive(buyFactor)) return -1;
    return future.findIndex((hour) => hour.low <= buyFactor);
  });
  // A window that bought in its final hour has nothing left to sell into, so it
  // can neither confirm nor deny the exit. It is excluded rather than counted
  // against the plan.
  const observable = windows
    .map((future, index) => ({ future, fill: fills[index] }))
    .filter(({ future, fill }) => fill >= 0 && fill < future.length - 1);
  const bestAfterFill = observable.map(({ future, fill }) => Math.max(...future.slice(fill + 1).map((hour) => hour.high)));

  // Geometric steps: prices are ratios, so equal multiplicative steps read
  // evenly whether the market is at 0.02 or 4000.
  const step = (Math.log(ceiling) - Math.log(floor)) / (levelCount - 1);
  const levels = [];
  for (let i = 0; i < levelCount; i += 1) {
    const factor = Math.exp(Math.log(floor) + step * i);
    levels.push({
      price: basis * factor,
      factor,
      buyReach: lowFactors.filter((value) => value <= factor).length / windows.length,
      sellReach: observable.length ? bestAfterFill.filter((value) => value >= factor).length / observable.length : null,
    });
  }

  // Read at the plan's exact prices, not at the nearest rung. Quoting the
  // nearest level put 64% under a curve whose panel said 68% — a discretisation
  // artefact that reads as two sources disagreeing.
  const sellFactor = positive(sellPrice) ? sellPrice / basis : null;
  return {
    levels,
    windows: windows.length,
    bought: fills.filter((fill) => fill >= 0).length,
    observable: observable.length,
    basis,
    atPlan: {
      buyReach: positive(buyFactor)
        ? lowFactors.filter((value) => value <= buyFactor).length / windows.length
        : null,
      sellReach: positive(sellFactor) && observable.length
        ? bestAfterFill.filter((value) => value >= sellFactor).length / observable.length
        : null,
    },
  };
}

/**
 * The cheapest buy that still reached `share` of windows.
 *
 * Reach rises with price — a buy near the market fills constantly, a deep
 * discount rarely — so this walks up from the bottom and stops at the first
 * price that clears the bar. That is the best price you can ask for while still
 * getting filled as often as you said you wanted.
 */
export function priceForBuyReach(ladder, share) {
  const hit = (ladder?.levels ?? []).find((level) => level.buyReach >= share);
  return hit ? hit.price : null;
}

/**
 * The dearest sell still reached in `share` of the windows that bought.
 *
 * The mirror image: sell reach FALLS as the price rises, so take the last level
 * that still clears the bar.
 */
export function priceForSellReach(ladder, share) {
  const hits = (ladder?.levels ?? []).filter((level) => level.sellReach != null && level.sellReach >= share);
  return hits.length ? hits.at(-1).price : null;
}
