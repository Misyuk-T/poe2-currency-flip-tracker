"use client";

import { useEffect, useState } from "react";
import { apiBaseUrl, currencyName, formatPercent, selectTopMovers } from "../lib/market.js";

// Tiny real sparkline from the row's stored 24h reference series (honest data,
// not decoration). Direction colour matches the % change.
function Sparkline({ values, up }) {
  const xs = (values ?? []).filter((v) => Number.isFinite(v));
  if (xs.length < 2) return <span className="home-spark home-spark-empty" aria-hidden="true" />;
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  const span = max - min || 1;
  const w = 46;
  const h = 16;
  const pts = xs
    .map((v, i) => `${((i / (xs.length - 1)) * w).toFixed(1)},${(h - ((v - min) / span) * (h - 2) - 1).toFixed(1)}`)
    .join(" ");
  return (
    <svg className="home-spark" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true" preserveAspectRatio="none">
      <polyline points={pts} className={up ? "home-spark-up" : "home-spark-down"} />
    </svg>
  );
}

// The MARKET RADAR panel's left rail: the homepage stays static/ISR HTML, this
// hydrates after load and pulls the latest movers from same-origin /api/radar.
// Stale rows are included here (the panel labels the data and shows its age), so
// the rail is never empty when there is data.
export default function HomeMiniRadar() {
  const [state, setState] = useState({ status: "loading", movers: [] });

  useEffect(() => {
    let cancelled = false;
    fetch(`${apiBaseUrl}/api/radar?anchor=exalted`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data) => {
        if (cancelled) return;
        const { movers } = selectTopMovers(data, { limit: 6, includeStale: true });
        setState({ status: movers.length ? "ready" : "empty", movers });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error", movers: [] });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="home-mini-radar" aria-label="Top PoE2 currency movers">
      <p className="home-mini-radar-title">Movers · 24h</p>

      {state.status === "loading" ? <p className="home-mini-radar-note">Loading…</p> : null}
      {state.status === "error" ? <p className="home-mini-radar-note">Movers unavailable right now.</p> : null}
      {state.status === "empty" ? <p className="home-mini-radar-note">No completed-hour data yet.</p> : null}

      {state.status === "ready" ? (
        <ul className="home-mini-radar-list">
          {state.movers.map((row) => {
            const move = row.movement.h24;
            const up = move >= 0;
            return (
              <li key={row.pairId}>
                <a href={`/poe2/currencies/${row.target}`}>
                  <span className="home-mini-radar-name">{row.targetName ?? currencyName(row.target)}</span>
                  <Sparkline values={row.sparkline24h} up={up} />
                  <span className={`home-mini-radar-move ${up ? "home-teal" : "home-loss"}`}>{formatPercent(move)}</span>
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
