/**
 * Server-side validation/clamping of user budget inputs.
 *
 * The API must not trust query parameters. Negative or malformed numbers are
 * clamped to safe values, and a gold reserve can never exceed available gold nor
 * (when negative) inflate the spendable budget. Returns the clamped constraints
 * plus a list of human-readable adjustments for transparency.
 */

export const HORIZON_MIN = 1;
export const HORIZON_MAX = 24;
export const HORIZON_DEFAULT = 3;

/**
 * Gold accounting modes:
 *   - "strict": gold is a hard budget — it caps position size and (by default)
 *     drives ranking via profit-per-100k-gold.
 *   - "show":   gold cost is computed and shown, but does NOT cap sizing.
 *     Ranking falls back to capital efficiency (ROI).
 *   - "ignore": gold is not used in sizing or ranking at all.
 */
export const GOLD_MODES = ["strict", "show", "ignore"];
export const GOLD_MODE_DEFAULT = "strict";

/**
 * @param {Object} raw  numbers (or null) parsed from the request
 * @returns {{ constraints: import("../domain/opportunities.js").UserConstraints, adjustments: string[] }}
 */
export function normalizeConstraints(raw = {}) {
  const adjustments = [];

  const currencyCapital = clampNonNegative(raw.currencyCapital, 0, "capital", adjustments);
  const goldAvailable = clampNonNegative(raw.goldAvailable, 0, "gold", adjustments);

  let goldReserve = clampNonNegative(raw.goldReserve, 0, "reserve", adjustments);
  if (goldReserve > goldAvailable) {
    goldReserve = goldAvailable; // reserve can never exceed available gold
    adjustments.push("reserve clamped to available gold");
  }

  let goldIncomePerHour = null;
  if (raw.goldIncomePerHour != null) {
    goldIncomePerHour = clampNonNegative(raw.goldIncomePerHour, 0, "income", adjustments);
  }

  let horizonHours = Number(raw.horizonHours);
  if (Number.isNaN(horizonHours) || horizonHours <= 0) {
    horizonHours = HORIZON_DEFAULT; // missing/invalid/non-positive -> default
  } else if (horizonHours < HORIZON_MIN) {
    horizonHours = HORIZON_MIN;
    adjustments.push(`horizon clamped to ${HORIZON_MIN}h`);
  } else if (horizonHours > HORIZON_MAX) {
    horizonHours = HORIZON_MAX; // also clamps +Infinity down to the max
    adjustments.push(`horizon clamped to ${HORIZON_MAX}h`);
  }

  let maxPositionTarget = null;
  if (raw.maxPositionTarget != null) {
    maxPositionTarget = Math.floor(clampNonNegative(raw.maxPositionTarget, 0, "maxPosition", adjustments));
  }

  let goldMode = raw.goldMode ?? GOLD_MODE_DEFAULT;
  if (!GOLD_MODES.includes(goldMode)) {
    if (raw.goldMode != null) adjustments.push(`gold mode "${raw.goldMode}" not recognized -> ${GOLD_MODE_DEFAULT}`);
    goldMode = GOLD_MODE_DEFAULT;
  }

  return {
    constraints: {
      currencyCapital,
      goldAvailable,
      goldReserve,
      goldIncomePerHour,
      horizonHours,
      maxPositionTarget,
      goldMode,
    },
    adjustments,
  };
}

function clampNonNegative(value, fallback, label, adjustments) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < 0) {
    adjustments.push(`${label} clamped to 0 (was negative)`);
    return 0;
  }
  return n;
}
