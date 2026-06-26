"use client";

import { useEffect, useState } from "react";
import { apiBaseUrl, currencyName, formatPercent, selectTopMovers } from "../lib/market.js";

// Small client widget under the hero: the homepage stays static/ISR HTML, this
// hydrates after load and pulls the latest top movers from the same-origin
// /api/radar. Every non-ready state is labelled honestly — no fabricated rows.
export default function HomeMiniRadar() {
  const [state, setState] = useState({ status: "loading", movers: [], sample: false });

  useEffect(() => {
    let cancelled = false;
    fetch(`${apiBaseUrl}/api/radar?anchor=exalted`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data) => {
        if (cancelled) return;
        const { movers, sample } = selectTopMovers(data, { limit: 5 });
        setState({ status: movers.length ? "ready" : "empty", movers, sample });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error", movers: [], sample: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="home-mini-radar" aria-label="Top PoE2 currency movers">
      <div className="home-mini-radar-head">
        <p className="eyebrow">Top movers · last completed hour</p>
        {state.sample ? <span className="home-data-badge">sample data</span> : null}
      </div>

      {state.status === "loading" ? <p className="home-mini-radar-note">Loading the latest hourly movers…</p> : null}
      {state.status === "error" ? (
        <p className="home-mini-radar-note">Live movers are unavailable right now — open the radar for the full market.</p>
      ) : null}
      {state.status === "empty" ? <p className="home-mini-radar-note">No completed-hour movement to show yet.</p> : null}

      {state.status === "ready" ? (
        <ul className="home-mini-radar-list">
          {state.movers.map((row) => {
            const move = row.movement.h24;
            return (
              <li key={row.pairId}>
                <a href={`/poe2/currencies/${row.target}`}>
                  <span className="home-mini-radar-name">{row.targetName ?? currencyName(row.target)}</span>
                  <span className={`home-mini-radar-move ${move >= 0 ? "home-teal" : "home-loss"}`}>
                    {move >= 0 ? "▲" : "▼"} {formatPercent(move)}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      ) : null}

      <a className="home-mini-radar-cta" href="/poe2">
        See the full radar →
      </a>
    </section>
  );
}
