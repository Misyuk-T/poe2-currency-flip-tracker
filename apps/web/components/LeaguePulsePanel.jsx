"use client";

import { useMemo } from "react";
import { mockLadderSnapshot } from "../lib/ggg-demo.js";
import { formatNumber } from "../lib/market.js";

/**
 * Demo of BACKLOG.md T5-T7 ("League Pulse" via `service:leagues:ladder`).
 * Deliberately descriptive only — no early/mature "verdict" — per the T6/T7
 * plan: a combined signal ships only once real ladder snapshots are
 * backtested against real CX volatility. Mocked data until T1 lands.
 */
export default function LeaguePulsePanel({ league }) {
  const snapshot = useMemo(() => (league ? mockLadderSnapshot(league) : null), [league]);
  if (!snapshot) return null;
  const maxCount = Math.max(...snapshot.distribution.map((bucket) => bucket.count), 1);

  return (
    <details className="league-pulse" aria-labelledby="league-pulse-title">
      <summary className="league-pulse-summary">
        <span id="league-pulse-title">
          League Pulse <span className="demo-badge inline"><b className="demo-tag">DEMO</b></span>
        </span>
        <span className="league-pulse-teaser">
          Day {snapshot.dayNumber} · median level {snapshot.medianLevel} · +{snapshot.levelsPerDay}/day
        </span>
      </summary>

      <div className="league-pulse-stats">
        <article>
          <span>Median level</span>
          <strong>{snapshot.medianLevel}</strong>
        </article>
        <article>
          <span>Growth</span>
          <strong>+{snapshot.levelsPerDay} lvl/day</strong>
        </article>
        <article>
          <span>Dead / retired</span>
          <strong>{formatNumber(snapshot.deadCount)}</strong>
        </article>
      </div>

      <div className="league-pulse-bars" role="img" aria-label="Ladder level distribution">
        {snapshot.distribution.map((bucket) => (
          <div className="lp-bar-col" key={bucket.label}>
            <div className="lp-bar-track">
              <div className="lp-bar-fill" style={{ height: `${Math.max(4, (bucket.count / maxCount) * 100)}%` }} />
            </div>
            <small>{bucket.label}</small>
          </div>
        ))}
      </div>

      <p className="league-pulse-note">
        How far into the league the top-1000 players have progressed — context for whether the market is still in
        its chaotic early phase. Simulated <code>service:leagues:ladder</code> data for now (that endpoint is
        public — it needs an app credential, <strong>never a player login</strong>). A top-1000 elite proxy that
        saturates a couple of weeks in; shown descriptively only, with no early/mature economy verdict until it is
        backtested against real currency volatility.
      </p>
    </details>
  );
}
