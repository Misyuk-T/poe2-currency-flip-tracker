"use client";

import { useEffect, useMemo, useState } from "react";
import { mockLadderSnapshot } from "../lib/ggg-demo.js";
import { formatNumber } from "../lib/market.js";

/**
 * Demo of BACKLOG.md T5-T7 ("League Pulse" via `service:leagues:ladder`).
 * Deliberately descriptive only — no early/mature "verdict" — per the T6/T7
 * plan: a combined signal ships only once real ladder snapshots are
 * backtested against real CX volatility. Mocked data until T1 lands.
 *
 * Rendered as a header control + modal (same shape as PocketValuator) so this
 * secondary context never competes with the market table for page space.
 * Unlike the pocket valuator, `service:leagues:ladder` is a PUBLIC endpoint —
 * it needs an app credential, never a player login — so there is no "connect"
 * framing here.
 */
export default function LeaguePulsePanel({ league }) {
  const [open, setOpen] = useState(false);
  const snapshot = useMemo(() => (league ? mockLadderSnapshot(league) : null), [league]);

  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!snapshot) return null;
  const maxCount = Math.max(...snapshot.distribution.map((bucket) => bucket.count), 1);

  return (
    <div className="league-pulse-control">
      <span>League</span>
      <button
        type="button"
        className="league-pulse-button"
        onClick={() => setOpen(true)}
        title="Demo only — simulated top-1000 ladder progression, not live GGG data."
      >
        Pulse
        <b className="demo-tag">DEMO</b>
      </button>

      {open && (
        <div className="rt-modal-backdrop" role="presentation" onClick={() => setOpen(false)}>
          <div
            className="pocket-modal"
            role="dialog"
            aria-modal="true"
            aria-label="League Pulse"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="pocket-modal-head">
              <div>
                <p className="pocket-character-line">
                  <strong>League Pulse</strong> · {league} · day {snapshot.dayNumber} ·{" "}
                  {formatNumber(snapshot.totalEntries)} characters tracked
                </p>
                <p className="eyebrow">Simulated ladder data · not live GGG data</p>
              </div>
              <button type="button" className="trade-close-button" aria-label="Close" title="Close" onClick={() => setOpen(false)}>
                ×
              </button>
            </header>

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
              How far into the league the top-1000 players have progressed — context for whether the market is
              still in its chaotic early phase. <strong>Simulated data for now</strong>, pending access to{" "}
              <code>service:leagues:ladder</code> (a public endpoint needing only an app credential — never a
              player login). A top-1000 elite proxy that saturates a couple of weeks in; shown descriptively only,
              with no early/mature economy verdict until it is backtested against real currency volatility.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
