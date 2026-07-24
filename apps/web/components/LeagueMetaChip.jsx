"use client";

import { useMemo } from "react";
import { mockLeagueMeta } from "../lib/ggg-demo.js";

/**
 * Demo of BACKLOG.md T3/T4 (league auto-sync via `service:leagues`).
 * All values are mocked — see lib/ggg-demo.js — until T1 (GGG OAuth scope
 * approval) lands.
 */
export default function LeagueMetaChip({ league }) {
  const meta = useMemo(() => (league ? mockLeagueMeta(league) : null), [league]);
  if (!meta) return null;
  return (
    <span
      className="demo-badge league-meta-chip"
      title="Demo of an auto-synced service:leagues read (BACKLOG T3/T4) — mocked, not a live GGG feed"
    >
      League day {meta.dayNumber} · ends in {meta.daysRemaining}d
      <b className="demo-tag">DEMO</b>
    </span>
  );
}
