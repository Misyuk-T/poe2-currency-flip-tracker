/**
 * Rate-budgeted target planner for live exchange polling.
 *
 * A target costs roughly 1.25 requests per anchor (one exit request plus its
 * share of a batched entry request), so polling the full catalog every five
 * minutes is neither polite nor feasible. This planner keeps a small hot set
 * current and rotates bounded slices of the larger catalog through warm/cold.
 */

export const DEFAULT_MARKET_CATEGORIES = ["Currency", "Fragments", "Essences"];

export function marketCandidates(catalog, { categories = DEFAULT_MARKET_CATEGORIES, exclude = [] } = {}) {
  const allowed = new Set(categories);
  const blocked = new Set(exclude);
  return unique((catalog?.items ?? [])
    .filter((item) => allowed.has(item.category) && !blocked.has(item.id))
    .map((item) => item.id));
}

export function estimateRequests(targetCount, anchorCount, batchSize = 4) {
  const n = Math.max(0, targetCount);
  const anchors = Math.max(0, anchorCount);
  const batch = Math.max(3, Math.min(5, batchSize));
  return anchors * (n + Math.ceil(n / batch));
}

export function createTieredScheduler({
  hotTargets = [],
  candidates = [],
  warmSize = 4,
  coldSize = 4,
  warmEveryMs = 15 * 60 * 1000,
  coldEveryMs = 60 * 60 * 1000,
  now = () => Date.now(),
} = {}) {
  const hot = unique(hotTargets);
  const rest = unique(candidates).filter((id) => !hot.includes(id));
  // The first third of the catalog-derived pool is warm. This is deterministic
  // and intentionally replaceable by cxapi activity ordering when OAuth access
  // is available; the remaining pool is sampled more slowly.
  const warmCut = Math.ceil(rest.length / 3);
  const warm = rest.slice(0, warmCut);
  const cold = rest.slice(warmCut);
  const hotSet = new Set(hot);
  const warmSet = new Set(warm);
  const coldSet = new Set(cold);
  let warmCursor = 0;
  let coldCursor = 0;
  let lastWarmAt = 0;
  let lastColdAt = 0;

  function next({ force = false, at = now() } = {}) {
    const tiers = ["hot"];
    const targets = [...hot];
    if (force || lastWarmAt === 0 || at - lastWarmAt >= warmEveryMs) {
      const picked = rotate(warm, warmCursor, warmSize);
      targets.push(...picked);
      tiers.push("warm");
    }
    if (force || lastColdAt === 0 || at - lastColdAt >= coldEveryMs) {
      const picked = rotate(cold, coldCursor, coldSize);
      targets.push(...picked);
      tiers.push("cold");
    }
    return { targets: unique(targets), tiers, plannedAt: at };
  }

  /** Advance cursors only after the whole multi-anchor cycle committed. */
  function commit(plan) {
    if (plan?.tiers?.includes("warm")) {
      warmCursor = advance(warmCursor, Math.min(warmSize, warm.length), warm.length);
      lastWarmAt = plan.plannedAt;
    }
    if (plan?.tiers?.includes("cold")) {
      coldCursor = advance(coldCursor, Math.min(coldSize, cold.length), cold.length);
      lastColdAt = plan.plannedAt;
    }
  }

  function status() {
    return {
      enabled: true,
      universeSize: unique([...hot, ...rest]).length,
      tierSizes: { hot: hot.length, warm: warm.length, cold: cold.length },
      batchSizes: { warm: warmSize, cold: coldSize },
      intervalsMs: { hot: null, warm: warmEveryMs, cold: coldEveryMs },
      cursors: { warm: warmCursor, cold: coldCursor },
      lastRunAt: { warm: lastWarmAt || null, cold: lastColdAt || null },
    };
  }

  function tierOf(id) {
    if (hotSet.has(id)) return "hot";
    if (warmSet.has(id)) return "warm";
    if (coldSet.has(id)) return "cold";
    return null;
  }

  return { next, commit, status, tierOf };
}

function rotate(items, cursor, count) {
  if (!items.length || count <= 0) return [];
  const n = Math.min(count, items.length);
  return Array.from({ length: n }, (_, i) => items[(cursor + i) % items.length]);
}

function advance(cursor, count, length) {
  return length ? (cursor + count) % length : 0;
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}
