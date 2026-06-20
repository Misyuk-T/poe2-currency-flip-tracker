/**
 * Horizon-aware history signal — TRANSPARENT, not predictive ML.
 *
 * Given the persisted market history for one target and a horizon (1/3/6h), we
 * derive a few honest descriptive statistics over the matching lookback window:
 *
 *   - meanSpreadPct           average gross spread in the window
 *   - spreadMomentumPctPerHour least-squares slope of spread vs time (trend)
 *   - spreadVolatility        population stdev of spread (noise/risk)
 *   - minSpreadPct/maxSpreadPct observed range
 *   - samples                 number of REAL observations used
 *   - spanHours               observed time span actually covered by those samples
 *   - coverageFraction        spanHours / horizonHours (how much of the horizon is real)
 *
 * These are computed ONLY from real, provider-matched observations passed in. We
 * return `status:"insufficient-history"` (with null metrics — never a synthesized
 * trend) when EITHER:
 *   - fewer than `minSamples` points fall inside the horizon window, OR
 *   - the points are clustered in too small a slice of the horizon
 *     (`coverageFraction < minCoverage`). Three samples taken over ten minutes do
 *     NOT describe a 6-hour horizon just because they fall inside the 6h window;
 *     requiring a defensible coverage fraction keeps the signal honest.
 *
 * The horizon changes the window, so it materially changes the metrics (and
 * therefore the heuristic ranking score derived from them).
 *
 * This is explicitly NOT a probability of fill/target and NOT a forecast. The
 * `fillProbability` fields elsewhere remain null by design.
 *
 * @typedef {Object} HistorySignal
 * @property {"ok"|"insufficient-history"} status
 * @property {number} horizonHours
 * @property {number} samples
 * @property {number} spanHours            observed span (newest-oldest) of the used points
 * @property {number} coverageFraction     spanHours / horizonHours, in [0, 1]
 * @property {boolean} synthetic          true if any point used is synthetic (fixture mode)
 * @property {number|null} meanSpreadPct
 * @property {number|null} spreadMomentumPctPerHour
 * @property {number|null} spreadVolatility
 * @property {number|null} minSpreadPct
 * @property {number|null} maxSpreadPct
 */

const HOUR_MS = 3600_000;

/**
 * Minimum fraction of the horizon that real samples must SPAN before the signal
 * is trusted (status:"ok"). Documented, overridable per call. 0.5 means at least
 * half the requested horizon must be covered by actual observations — so a
 * 6-hour signal needs ≥3h of real span, not three readings ten minutes apart.
 */
export const DEFAULT_MIN_COVERAGE = 0.5;

/**
 * @param {import("../server/history-store.js").HistoryPoint[]} points
 * @param {{ now?: number, horizonHours?: number, minSamples?: number, minCoverage?: number }} [opts]
 * @returns {HistorySignal}
 */
export function computeHistorySignal(points, opts = {}) {
  const now = opts.now ?? Date.now();
  const horizonHours = positiveOr(opts.horizonHours, 3);
  const minSamples = opts.minSamples ?? 3;
  const minCoverage = opts.minCoverage ?? DEFAULT_MIN_COVERAGE;
  const windowMs = horizonHours * HOUR_MS;

  const inWindow = (points ?? [])
    .filter((p) => p && Number.isFinite(p.t) && p.t >= now - windowMs && Number.isFinite(p.spreadPct))
    .sort((a, b) => a.t - b.t);

  const synthetic = inWindow.some((p) => p.synthetic === true);
  const spanHours = inWindow.length ? (inWindow[inWindow.length - 1].t - inWindow[0].t) / HOUR_MS : 0;
  const coverageFraction = horizonHours > 0 ? Math.min(1, spanHours / horizonHours) : 0;

  const insufficient = inWindow.length < minSamples || coverageFraction + 1e-9 < minCoverage;
  if (insufficient) {
    return {
      status: "insufficient-history",
      horizonHours,
      samples: inWindow.length,
      spanHours,
      coverageFraction,
      synthetic,
      meanSpreadPct: null,
      spreadMomentumPctPerHour: null,
      spreadVolatility: null,
      minSpreadPct: null,
      maxSpreadPct: null,
    };
  }

  const spreads = inWindow.map((p) => p.spreadPct);
  const mean = avg(spreads);
  const variance = avg(spreads.map((s) => (s - mean) ** 2));
  const volatility = Math.sqrt(variance);

  // Least-squares slope of spread (pp) vs time (hours), relative to window start.
  const t0 = inWindow[0].t;
  const xs = inWindow.map((p) => (p.t - t0) / HOUR_MS);
  const xMean = avg(xs);
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - xMean) * (spreads[i] - mean);
    den += (xs[i] - xMean) ** 2;
  }
  const momentum = den > 0 ? num / den : 0;

  return {
    status: "ok",
    horizonHours,
    samples: inWindow.length,
    spanHours,
    coverageFraction,
    synthetic,
    meanSpreadPct: mean,
    spreadMomentumPctPerHour: momentum,
    spreadVolatility: volatility,
    minSpreadPct: Math.min(...spreads),
    maxSpreadPct: Math.max(...spreads),
  };
}

/**
 * Bounded, transparent horizon multiplier applied to the resource-adjusted
 * metric (profit per 100k gold) to produce a ranking score. Rewards a spread
 * that is trending up over the horizon and penalizes a noisy/volatile spread.
 * Constants are deliberately simple and documented; this is a heuristic ordering
 * aid, NOT a probability. Returns 1 (no adjustment) when the signal is absent.
 *
 * @param {HistorySignal|null} signal
 * @returns {number}
 */
export function horizonAdjustment(signal) {
  if (!signal || signal.status !== "ok") return 1;
  const m = signal.spreadMomentumPctPerHour ?? 0; // pp per hour
  const v = signal.spreadVolatility ?? 0; // pp stdev
  const momentumAdj = clamp(1 + m / 20, 0.6, 1.4); // +1pp/h spread ~ +5%
  const volatilityAdj = clamp(1 - v / 40, 0.6, 1.0); // noisier spread ranks lower
  return momentumAdj * volatilityAdj;
}

function avg(arr) {
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

function positiveOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
