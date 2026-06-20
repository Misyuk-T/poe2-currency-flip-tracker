/**
 * Order-book assembly and depth sweeping.
 *
 * A book is a list of {@link import("./offers.js").BookLevel} sorted in the
 * order they should be consumed:
 *   - "entry" (buying target with anchor): cheapest anchor-per-target first;
 *   - "exit"  (selling target for anchor): highest anchor-per-target first.
 *
 * Sweeping fills a requested target quantity in whole bundles, never reporting
 * more than the book supports. Anchor amount is anchor SPENT on entry / anchor
 * RECEIVED on exit (same price convention, same arithmetic).
 */

/**
 * @param {import("./offers.js").BookLevel[]} levels
 * @returns {import("./offers.js").BookLevel[]} sorted copy
 */
export function buildBook(levels) {
  if (!levels.length) return [];
  const side = levels[0].side;
  const sorted = [...levels];
  sorted.sort((a, b) => (side === "entry" ? a.price - b.price : b.price - a.price));
  return sorted;
}

/** Total fillable target quantity in the book. */
export function bookDepth(book) {
  return book.reduce((sum, lvl) => sum + lvl.availableTarget, 0);
}

const EPS = 1e-9;

/**
 * The set of quantities this book can fill EXACTLY (no shortfall) under the SAME
 * greedy best-first sweep used by {@link sweep}, in ascending order, up to
 * `cap`. Used to pick a round-trip size both legs can fully execute (no partial
 * fill from bundle-size incompatibility).
 *
 * It is NOT simply the running cumulative bundle sums: greedy sweep SKIPS a
 * level whose bundle is larger than the quantity still remaining and fills from
 * a later, smaller-bundle level instead. A naive prefix-sum enumeration misses
 * those mixed-bundle quantities (e.g. a cheap bundle-of-5 level followed by a
 * worse bundle-of-1 level can still fill 1/2/3 from the later level). This walks
 * the book from the LAST (worst) level toward the first, tracking the quantity
 * already committed at later levels ("tail"): taking fewer than all bundles at a
 * level is only greedy-consistent when that tail is smaller than one bundle here
 * (otherwise greedy would consume more at this better-priced level). Each
 * generated quantity therefore satisfies sweep(book, q).filledTarget === q.
 *
 * Bounded by `cap`, by a per-state memo (so it is polynomial in levels × the
 * number of distinct reachable sums, never exponential), and by a hard safety
 * limit on enumeration steps.
 *
 * @param {import("./offers.js").BookLevel[]} book sorted book (see buildBook)
 * @param {number} cap
 * @param {number} [maxSteps] safety bound on enumeration steps
 * @returns {number[]} ascending, distinct reachable quantities (excludes 0)
 */
export function reachableQuantities(book, cap, maxSteps = 200_000) {
  const limit = Math.max(0, cap);
  if (!book.length || limit <= 0) return [];

  const results = new Set();
  const visited = new Set();
  let steps = 0;
  let overflow = false;

  const key = (n) => Math.round(n * 1e6); // snap float dust for stable keys

  // `i` is the current level index (walked back-to-front); `tail` is the target
  // quantity already committed at levels AFTER `i` (i.e. it passes through this
  // level untouched by greedy).
  const recurse = (i, tail) => {
    if (overflow) return;
    if (tail > limit + EPS) return; // pruning: only grows from here

    if (i < 0) {
      if (tail > EPS) results.add(key(tail) / 1e6);
      return;
    }

    const stateKey = `${i}:${key(tail)}`;
    if (visited.has(stateKey)) return;
    visited.add(stateKey);
    if (++steps > maxSteps) {
      overflow = true;
      return;
    }

    const level = book[i];
    const b = level.bundleTarget;
    const maxK = Math.floor(level.availableTarget / b + EPS); // whole bundles here

    if (tail < b - EPS) {
      // Greedy may take any 0..maxK bundles here: leaving k<maxK is consistent
      // because the tail passing through is below one bundle.
      const fits = Math.floor((limit - tail) / b + EPS);
      const upper = Math.min(maxK, fits);
      for (let k = 0; k <= upper; k++) {
        recurse(i - 1, tail + k * b);
      }
    } else {
      // tail >= one bundle: greedy is forced to consume ALL maxK bundles here.
      recurse(i - 1, tail + maxK * b);
    }
  };

  recurse(book.length - 1, 0);
  return [...results].sort((a, b) => a - b);
}

/**
 * True iff the book can fill EXACTLY `qty` target units (no shortfall) from
 * best-first whole-bundle consumption.
 *
 * @param {import("./offers.js").BookLevel[]} book sorted book
 * @param {number} qty
 */
export function canFullyFill(book, qty) {
  if (qty <= 0) return true;
  // Epsilon-tolerant equality: reachableQuantities and sweep accumulate bundle
  // sizes via different float paths, which can disagree in the last ULP for
  // fractional bundle sizes.
  return Math.abs(sweep(book, qty).filledTarget - qty) < 1e-9;
}

/**
 * @typedef {Object} SweepResult
 * @property {number} filledTarget     Target units actually filled (bundle-aligned).
 * @property {number} unfilledTarget   Requested minus filled (>= 0).
 * @property {number} anchorAmount     Anchor spent (entry) or received (exit).
 * @property {number|null} vwap        Executable volume-weighted anchor-per-target, or null.
 * @property {number|null} worstPrice  Worst marginal price used, or null.
 * @property {number} levelsUsed
 * @property {number} uniqueAccounts
 * @property {string|null} oldestIndexed ISO timestamp of the oldest level used.
 */

/**
 * Sweep `requestedTarget` target units across the (already sorted) book.
 *
 * @param {import("./offers.js").BookLevel[]} book
 * @param {number} requestedTarget
 * @returns {SweepResult}
 */
export function sweep(book, requestedTarget) {
  let remaining = Math.max(0, requestedTarget);
  let filledTarget = 0;
  let anchorAmount = 0;
  let worstPrice = null;
  let levelsUsed = 0;
  const accounts = new Set();
  let oldestIndexed = null;

  for (const level of book) {
    if (remaining <= 0) break;
    const maxBundlesHere = Math.floor(level.availableTarget / level.bundleTarget);
    const bundlesWanted = Math.floor(remaining / level.bundleTarget);
    const bundles = Math.min(maxBundlesHere, bundlesWanted);
    if (bundles <= 0) continue; // cannot fit even one whole bundle within remaining

    const fill = bundles * level.bundleTarget;
    filledTarget += fill;
    remaining -= fill;
    anchorAmount += fill * level.price;
    worstPrice = level.price;
    levelsUsed += 1;
    if (level.account) accounts.add(level.account);
    if (level.indexed && (oldestIndexed === null || level.indexed < oldestIndexed)) {
      oldestIndexed = level.indexed;
    }
  }

  return {
    filledTarget,
    unfilledTarget: Math.max(0, requestedTarget - filledTarget),
    anchorAmount,
    vwap: filledTarget > 0 ? anchorAmount / filledTarget : null,
    worstPrice,
    levelsUsed,
    uniqueAccounts: accounts.size,
    oldestIndexed,
  };
}
