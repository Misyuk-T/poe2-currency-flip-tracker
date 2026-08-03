"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchJsonCached, peekCachedJson } from "../lib/market.js";

const TTL_MS = 6 * 60 * 60_000;

export default function LeagueMetaChip({ game, league }) {
  const requestUrl = useMemo(() => {
    if (game !== "poe1" || !league) return null;
    return `/api/league-meta?game=poe1&league=${encodeURIComponent(league)}`;
  }, [game, league]);
  const cached = requestUrl ? peekCachedJson(requestUrl, { ttlMs: TTL_MS }) : null;
  const [response, setResponse] = useState(null);

  useEffect(() => {
    if (!requestUrl) return;
    let cancelled = false;
    fetchJsonCached(requestUrl, { ttlMs: TTL_MS })
      .then((data) => {
        if (!cancelled) setResponse({ requestUrl, data });
      })
      .catch(() => {
        if (!cancelled) setResponse({ requestUrl, data: { available: false } });
      });
    return () => {
      cancelled = true;
    };
  }, [requestUrl]);

  if (!requestUrl) return null;
  const meta = response?.requestUrl === requestUrl ? response.data : cached;
  if (!meta) return <span className="sk league-meta-placeholder live" aria-hidden="true" />;
  if (!meta.available) return null;

  const label = meta.kind === "permanent"
    ? "Permanent league"
    : `League day ${meta.dayNumber}${Number.isFinite(meta.daysRemaining) ? ` · ends in ${meta.daysRemaining}d` : ""}`;
  return (
    <span
      className="league-meta-chip"
      title="League timing from GGG's PoE 1 leagues feed; cached by Exile Radar"
    >
      {label}
      <b className="league-meta-source">GGG</b>
    </span>
  );
}
