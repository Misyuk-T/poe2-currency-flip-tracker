/**
 * Snapshot assembly: turn provider responses into normalized books, then into
 * ranked opportunities. Book fetching (I/O) is separated from opportunity
 * computation (pure) so the server can cache books and recompute metrics for
 * different user constraints without re-hitting the provider.
 */

import { normalizeResult } from "../domain/offers.js";
import { buildOpportunity } from "../domain/opportunities.js";

/**
 * Targets to maintain books for, for a given anchor: the shortlist plus the
 * other anchors (so Exalted<->Divine round trips work), minus the anchor itself.
 */
export function catalogTargets(anchor, shortlist, anchors) {
  const set = new Set([...shortlist, ...anchors]);
  set.delete(anchor);
  return [...set];
}

/**
 * Fetch entry + exit books for every shortlist target.
 *
 * Entry direction (have=anchor) is batched in groups of `batchSize` (3-5).
 * Exit direction (have=target) cannot be batched across targets because `have`
 * differs, so it is one request per target.
 *
 * @returns {Promise<{ fetchedAt: number, anchorId: string, byTarget: Record<string, {entryLevels: any[], exitLevels: any[]}> }>}
 */
export async function fetchBooks(provider, { anchorId, shortlist, batchSize = 4 }) {
  const byTarget = {};
  const fetchedAt = Date.now();
  for (const targetId of shortlist) byTarget[targetId] = { entryLevels: [], exitLevels: [], fetchedAt };

  // Entry legs, batched.
  for (const group of chunk(shortlist, clampBatch(batchSize))) {
    const payload = await provider.fetchExchange({ have: [anchorId], want: group });
    for (const targetId of group) {
      byTarget[targetId].entryLevels = normalizeResult(payload.result, {
        side: "entry",
        anchorId,
        targetId,
      });
    }
  }

  // Exit legs, one request per target.
  for (const targetId of shortlist) {
    const payload = await provider.fetchExchange({ have: [targetId], want: [anchorId] });
    byTarget[targetId].exitLevels = normalizeResult(payload.result, {
      side: "exit",
      anchorId,
      targetId,
    });
  }

  return { fetchedAt: Date.now(), anchorId, byTarget };
}

/** Merge an incremental tier fetch into an anchor snapshot. */
export function mergeBooks(previous, incremental) {
  if (!previous) return incremental;
  if (previous.anchorId !== incremental.anchorId) throw new Error("cannot merge books from different anchors");
  return {
    anchorId: incremental.anchorId,
    fetchedAt: Math.max(previous.fetchedAt ?? 0, incremental.fetchedAt ?? 0),
    byTarget: { ...previous.byTarget, ...incremental.byTarget },
  };
}

/** Keep the newest bounded target set while never evicting explicitly preserved ids. */
export function pruneBooks(books, { maxTargets = 250, preserve = [] } = {}) {
  const entries = Object.entries(books.byTarget ?? {});
  if (entries.length <= maxTargets) return books;
  const keep = new Set(preserve);
  const newest = entries
    .filter(([id]) => !keep.has(id))
    .sort((a, b) => (b[1].fetchedAt ?? 0) - (a[1].fetchedAt ?? 0));
  for (const [id] of newest) {
    if (keep.size >= maxTargets) break;
    keep.add(id);
  }
  return { ...books, byTarget: Object.fromEntries(entries.filter(([id]) => keep.has(id))) };
}

/**
 * Pure: compute ranked opportunities from cached books + user constraints.
 */
export const RANKING_MODES = [
  "default", // horizon-adjusted score (gold-mode dependent)
  "profit", // current-book gross profit
  "roi", // currency ROI
  "profit-100k", // profit per 100k gold
  "profit-hour", // profit per horizon hour
  "liquidity", // highest fully-executable depth
  "risk", // lowest risk heuristic
];

/** Metric accessor + direction per ranking mode. `lowerIsBetter` only for risk. */
const RANK_METRIC = {
  default: { get: (o) => o.riskAdjustedScore, lowerIsBetter: false },
  profit: { get: (o) => o.ranking?.profit, lowerIsBetter: false },
  roi: { get: (o) => o.ranking?.roi, lowerIsBetter: false },
  "profit-100k": { get: (o) => o.ranking?.profitPer100kGold, lowerIsBetter: false },
  "profit-hour": { get: (o) => o.ranking?.profitPerHour, lowerIsBetter: false },
  liquidity: { get: (o) => o.ranking?.liquidity, lowerIsBetter: false },
  risk: { get: (o) => o.ranking?.riskScore, lowerIsBetter: true },
};

export function computeOpportunities({
  books,
  goldRegistry,
  constraints,
  names = {},
  history = {},
  rankingMode = "default",
  now = Date.now(),
  maxListingAgeMs = null,
}) {
  const { anchorId, byTarget } = books;
  const opportunities = Object.entries(byTarget).map(([targetId, legs]) =>
    buildOpportunity({
      anchorId,
      targetId,
      targetName: names[targetId] ?? targetId,
      entryLevels: legs.entryLevels,
      exitLevels: legs.exitLevels,
      goldRegistry,
      constraints,
      history: history[targetId] ?? [],
      now,
      maxListingAgeMs,
    }),
  );

  const metric = RANK_METRIC[rankingMode] ?? RANK_METRIC.default;
  const dir = metric.lowerIsBetter ? -1 : 1;
  // Null metrics always sort last; gross profit breaks ties.
  opportunities.sort((a, b) => {
    const va = metric.get(a);
    const vb = metric.get(b);
    if (va == null && vb == null) return (b.grossProfit ?? 0) - (a.grossProfit ?? 0);
    if (va == null) return 1;
    if (vb == null) return -1;
    if (vb !== va) return (vb - va) * dir;
    return (b.grossProfit ?? 0) - (a.grossProfit ?? 0);
  });

  return opportunities;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function clampBatch(n) {
  return Math.max(3, Math.min(5, n));
}
