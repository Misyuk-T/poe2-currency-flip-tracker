/**
 * Is the observed history steady enough to base a trade plan on?
 *
 * A thin market produces spectacular-looking guidance from nothing. Two
 * isolated fills hours apart at 1 and 4,500 exalted give a huge "range", a
 * meaningless median, and a headline margin in the thousands of percent — and
 * none of it is tradeable, because there was never a book to trade against.
 * Showing that number is worse than showing nothing: it is the most eye-catching
 * row on the page and it is pure measurement noise.
 *
 * This does NOT try to judge whether a trade is good. It answers a narrower,
 * checkable question: are these observations consistent enough that a median
 * and a range mean anything? When the answer is no, the caller shows the
 * reason instead of a plan.
 *
 * The thresholds below are judgement calls, not derived constants — they are
 * named and exported so they can be argued with and tuned against real data
 * rather than buried in an expression.
 */

/** Ratio between the high and low observed midpoint beyond which the series is
 *  scattered rather than trending. 4x within the window is already extreme for
 *  a currency pair. */
export const ERRATIC_SPREAD_RATIO = 4;

/** A suggested buy->sell margin above this is not an edge anyone is leaving on
 *  the table; in a market this liquid it means the inputs are noise. */
export const IMPLAUSIBLE_MARGIN = 1.0; // 100%

/** Fewer completed hours than this and there is nothing to be steady about. */
export const MIN_OBSERVATIONS = 6;

function midpoints(points) {
  return (points ?? [])
    .map((point) => Number(point?.reference))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
}

/**
 * @param {Array<{reference:number}>} points completed-hour history
 * @param {{ rangePotential?: number|null }} guidance the computed plan
 * @returns {{ usable: boolean, reason: string|null, detail: string|null,
 *             observations: number, spreadRatio: number|null }}
 */
export function planReliability(points, guidance = {}) {
  const values = midpoints(points);
  const observations = values.length;
  const low = values[0] ?? null;
  const high = values.at(-1) ?? null;
  const spreadRatio = low > 0 && high > 0 ? high / low : null;

  const base = { observations, spreadRatio };

  if (observations < MIN_OBSERVATIONS) {
    return {
      ...base,
      usable: false,
      reason: "too-few-observations",
      detail: `Only ${observations} completed ${observations === 1 ? "hour" : "hours"} of trading in this window.`,
    };
  }

  if (spreadRatio != null && spreadRatio > ERRATIC_SPREAD_RATIO) {
    return {
      ...base,
      usable: false,
      reason: "erratic-prices",
      detail: `Observed prices swing ${Math.round(spreadRatio)}× between the low and high of this window, so a median is not meaningful.`,
    };
  }

  const margin = Number(guidance?.rangePotential);
  if (Number.isFinite(margin) && margin > IMPLAUSIBLE_MARGIN) {
    return {
      ...base,
      usable: false,
      reason: "implausible-margin",
      detail: "The implied margin is too large to be a real opportunity — it reflects scattered trades, not a spread you could fill.",
    };
  }

  return { ...base, usable: true, reason: null, detail: null };
}
