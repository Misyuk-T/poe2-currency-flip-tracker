/**
 * Executable quote: what a requested quantity actually costs/earns right now,
 * given current book depth. This is the honest answer to "what is the price",
 * as opposed to naively reading the best visible listing.
 */

import { sweep } from "./order-book.js";

/**
 * @typedef {Object} ExecutableQuote
 * @property {number} requestedTarget
 * @property {number} filledTarget
 * @property {number} unfilledTarget
 * @property {boolean} partial          true when the book could not fully fill.
 * @property {number} anchorAmount      anchor spent (entry) or received (exit).
 * @property {number|null} vwap         executable weighted-average anchor-per-target.
 * @property {number|null} worstPrice
 * @property {number} levelsUsed
 * @property {number} uniqueAccounts
 * @property {string|null} oldestIndexed
 * @property {number|null} oldestAgeMs
 * @property {boolean} stale            oldest used level older than maxListingAgeMs.
 */

/**
 * @param {import("./offers.js").BookLevel[]} book  sorted book (see order-book.buildBook)
 * @param {number} requestedTarget
 * @param {{ now?: number, maxListingAgeMs?: number|null }} [opts]
 * @returns {ExecutableQuote}
 */
export function executableQuote(book, requestedTarget, opts = {}) {
  const now = opts.now ?? Date.now();
  const maxAge = opts.maxListingAgeMs ?? null;
  const s = sweep(book, requestedTarget);

  let oldestAgeMs = null;
  let stale = false;
  if (s.oldestIndexed) {
    const t = Date.parse(s.oldestIndexed);
    if (Number.isFinite(t)) {
      oldestAgeMs = now - t;
      if (maxAge != null && oldestAgeMs > maxAge) stale = true;
    }
  }

  return {
    requestedTarget,
    filledTarget: s.filledTarget,
    unfilledTarget: s.unfilledTarget,
    partial: s.unfilledTarget > 0,
    anchorAmount: s.anchorAmount,
    vwap: s.vwap,
    worstPrice: s.worstPrice,
    levelsUsed: s.levelsUsed,
    uniqueAccounts: s.uniqueAccounts,
    oldestIndexed: s.oldestIndexed,
    oldestAgeMs,
    stale,
  };
}
