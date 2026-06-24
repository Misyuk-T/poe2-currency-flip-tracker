/** Stable, explainable automatic hotlist. No upstream I/O. */

export function buildHotlist({ pinned = [], radar = [], previous = [], maxTargets = 8, now = Date.now(), minTenureMs = 2 * 3600_000 } = {}) {
  const selected = new Map();
  for (const id of pinned) selected.set(id, { id, reason: "pinned", selectedAt: previous.find((x) => x.id === id)?.selectedAt ?? now });
  const ranked = [...radar]
    .filter((r) => r.status === "ok" && !r.stale)
    .sort((a, b) => Math.max(b.activityScore ?? 0, b.arbitrageScore ?? 0) - Math.max(a.activityScore ?? 0, a.arbitrageScore ?? 0));

  // Retain young automatic entries to prevent hourly churn.
  for (const old of previous) {
    if (selected.size >= maxTargets) break;
    if (old.reason !== "pinned" && now - old.selectedAt < minTenureMs) selected.set(old.id, old);
  }
  for (const row of ranked) {
    if (selected.size >= maxTargets) break;
    if (selected.has(row.target)) continue;
    const reason = (row.activityScore ?? 0) >= (row.arbitrageScore ?? 0) ? "activity" : "arbitrage";
    selected.set(row.target, { id: row.target, reason, selectedAt: now, score: Math.max(row.activityScore ?? 0, row.arbitrageScore ?? 0) });
  }
  return [...selected.values()].slice(0, Math.max(maxTargets, pinned.length));
}
