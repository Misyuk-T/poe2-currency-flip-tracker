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
    <section className="league-pulse" aria-labelledby="league-pulse-title">
      <div className="key-currencies-heading">
        <div>
          <p className="eyebrow">Top-1000 ladder · descriptive only</p>
          <h3 id="league-pulse-title">
            League Pulse <span className="demo-badge inline"><b className="demo-tag">DEMO</b></span>
          </h3>
        </div>
        <span>Day {snapshot.dayNumber} · {formatNumber(snapshot.totalEntries)} tracked</span>
      </div>

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
        Simulated <code>service:leagues:ladder</code> aggregate (mocked data, pending GGG OAuth scope T1) — a
        top-1000 elite-progression proxy that saturates a couple of weeks into a league. Shown descriptively only;
        no early/mature economy verdict is claimed without a real backtest against currency volatility.
      </p>
    </section>
  );
}
