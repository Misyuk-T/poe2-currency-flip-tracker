"use client";

import { useEffect, useMemo, useState } from "react";
import SpotChart from "./SpotChart.jsx";
import { convertMarketPrice, currentPriceGuidance, workingPrice } from "../lib/price-guidance.js";
import {
  apiBaseUrl,
  displayDigits,
  formatAge,
  formatDurationHours,
  formatNumber,
  formatPercent,
  iconUrl,
} from "../lib/market.js";

const MANUAL_PRICE_KEY = "poe2flip.next.manualPrices.v1";

function formatPriceParts(price) {
  if (!price?.unit || !Number.isFinite(price.value)) return null;
  return {
    value: formatNumber(price.value, { maximumFractionDigits: displayDigits(price.value) }),
    unit: price.unit,
  };
}

function formatPrice(row) {
  const price = row?.displayPrice;
  const parts = formatPriceParts(price);
  return parts ? `${parts.value} ${parts.unit}` : "—";
}

function PricePill({ value, unit }) {
  if (!unit || !Number.isFinite(value)) return <span>—</span>;
  return (
    <span className="price-pill">
      <span>{formatNumber(value, { maximumFractionDigits: displayDigits(value) })}</span>
      <img src={iconUrl(unit)} alt="" />
    </span>
  );
}

function loadManualPrices() {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(MANUAL_PRICE_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveManualPrices(prices) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(MANUAL_PRICE_KEY, JSON.stringify(prices));
}

export default function MarketDashboard() {
  const [radar, setRadar] = useState(null);
  const [history, setHistory] = useState([]);
  const [selectedPair, setSelectedPair] = useState(null);
  const [status, setStatus] = useState("loading");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("activity");
  const [horizon, setHorizon] = useState(3);
  const [manualPrices, setManualPrices] = useState({});
  const [draftPrice, setDraftPrice] = useState("");
  const [draftUnit, setDraftUnit] = useState("exalted");

  useEffect(() => {
    setManualPrices(loadManualPrices());
  }, []);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    fetch(`${apiBaseUrl}/api/radar?anchor=exalted`, { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`Radar failed: ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setRadar(data);
        const first = data.rows?.find((row) => row.pairId && row.status !== "no-trades-this-hour");
        setSelectedPair(first?.pairId ?? null);
        setStatus("ready");
      })
      .catch((error) => {
        if (!cancelled) {
          setStatus(error.message);
          setRadar(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedPair) return;
    let cancelled = false;
    fetch(`${apiBaseUrl}/api/radar/history?pair=${encodeURIComponent(selectedPair)}&anchor=exalted`, { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`History failed: ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setHistory(data.series ?? []);
      })
      .catch(() => {
        if (!cancelled) setHistory([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPair]);

  const rows = useMemo(
    () => (radar?.rows ?? [])
      .filter((row) => row.pairId && row.status !== "no-trades-this-hour")
      .filter((row) => {
        const q = search.trim().toLowerCase();
        return !q || row.targetName?.toLowerCase().includes(q) || row.target?.toLowerCase().includes(q);
      })
      .sort((a, b) => {
        if (sort === "price") return (b.reference ?? -1) - (a.reference ?? -1);
        if (sort === "gainers") return (b.movement?.h24 ?? -Infinity) - (a.movement?.h24 ?? -Infinity);
        if (sort === "losers") return (a.movement?.h24 ?? Infinity) - (b.movement?.h24 ?? Infinity);
        if (sort === "volume") return (b.volume ?? -1) - (a.volume ?? -1);
        return (b.activityScore ?? -1) - (a.activityScore ?? -1);
      })
      .slice(0, 100),
    [radar, search, sort],
  );
  const selected = rows.find((row) => row.pairId === selectedPair) ?? rows[0];
  const selectedManual = selected?.pairId ? manualPrices[selected.pairId] : null;
  const currentWorkingPrice = selected
    ? workingPrice(selected, selectedManual, { divineInExalted: radar?.units?.divineInExalted })
    : { status: "missing", value: null, unit: null, anchorValue: null };
  const guidance = useMemo(
    () => currentPriceGuidance(history, currentWorkingPrice.anchorValue, { horizonHours: horizon }),
    [currentWorkingPrice.anchorValue, history, horizon],
  );
  const guidanceUnit = currentWorkingPrice.unit ?? selected?.displayPrice?.unit ?? selected?.anchor ?? "exalted";
  const entry = guidance.status === "ok"
    ? convertMarketPrice(guidance.entry, selected?.anchor, guidanceUnit, radar?.units?.divineInExalted)
    : null;
  const exit = guidance.status === "ok"
    ? convertMarketPrice(guidance.exit, selected?.anchor, guidanceUnit, radar?.units?.divineInExalted)
    : null;

  useEffect(() => {
    if (!selected) return;
    const saved = manualPrices[selected.pairId];
    if (saved?.value && saved?.unit) {
      setDraftPrice(String(saved.value));
      setDraftUnit(saved.unit);
    } else {
      const fallbackUnit = selected.displayPrice?.unit ?? selected.anchor ?? "exalted";
      setDraftPrice("");
      setDraftUnit(fallbackUnit);
    }
  }, [manualPrices, selected]);

  function applyManualPrice() {
    if (!selected?.pairId) return;
    const value = Number(draftPrice);
    const next = { ...manualPrices };
    if (Number.isFinite(value) && value > 0 && ["exalted", "divine"].includes(draftUnit)) {
      next[selected.pairId] = { value, unit: draftUnit, updatedAt: Date.now() };
    } else {
      delete next[selected.pairId];
    }
    setManualPrices(next);
    saveManualPrices(next);
  }

  function clearManualPrice() {
    if (!selected?.pairId) return;
    const next = { ...manualPrices };
    delete next[selected.pairId];
    setManualPrices(next);
    saveManualPrices(next);
  }

  return (
    <section className="dashboard-shell">
      <aside className="market-list" aria-label="Hourly markets">
        <div className="panel-heading">
          <span>{status === "ready" ? "Hourly markets" : "Loading radar…"}</span>
          <small>{radar?.source?.sourceMode ?? "backend"}</small>
        </div>
        <div className="market-controls">
          <label>
            Search
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Currency, rune, essence…" />
          </label>
          <label>
            Sort
            <select value={sort} onChange={(event) => setSort(event.target.value)}>
              <option value="activity">Activity</option>
              <option value="price">Price high to low</option>
              <option value="gainers">24h gainers</option>
              <option value="losers">24h losers</option>
              <option value="volume">Volume</option>
            </select>
          </label>
          <small>Showing {rows.length} markets</small>
        </div>
        {rows.map((row) => (
          <button
            className={row.pairId === selected?.pairId ? "market-row active" : "market-row"}
            key={row.pairId}
            onClick={() => setSelectedPair(row.pairId)}
            type="button"
          >
            <img src={iconUrl(row.target)} alt="" />
            <span>
              <strong>{row.targetName}</strong>
              <small>{formatPrice(row)}</small>
            </span>
            <em className={(row.movement?.h24 ?? 0) >= 0 ? "up" : "down"}>{formatPercent(row.movement?.h24)}</em>
          </button>
        ))}
        {!rows.length && <p className="empty-copy">{status}</p>}
      </aside>

      <div className="chart-panel">
        <div className="chart-title-row">
          <div>
            <p className="eyebrow">Binance-style hourly range chart</p>
            <h2>{selected?.targetName ?? "Select a market"} / Exalted</h2>
          </div>
          {selected && (
            <div className="chart-kpis">
              <span>{formatPrice(selected)}</span>
              <strong className={(selected.movement?.h24 ?? 0) >= 0 ? "up" : "down"}>{formatPercent(selected.movement?.h24)} 24h</strong>
            </div>
          )}
        </div>
        <SpotChart points={history} />
        {selected && (
          <section className="trade-guidance-panel" aria-label="Trade guidance">
            <div className="guidance-header">
              <div>
                <p className="eyebrow">Manual current price</p>
                <h3>{currentWorkingPrice.source === "manual" ? "Plan from your real quote" : "Plan from hourly midpoint"}</h3>
                <p>
                  Use the price you see in-game now. Hourly history is only used to estimate a conservative entry/exit
                  envelope for the selected holding window.
                </p>
              </div>
              <label>
                Horizon
                <select value={horizon} onChange={(event) => setHorizon(Number(event.target.value))}>
                  <option value={1}>1h scalp</option>
                  <option value={3}>3h</option>
                  <option value={6}>6h</option>
                  <option value={10}>10h overnight</option>
                  <option value={24}>24h</option>
                </select>
              </label>
            </div>

            <div className="working-price-card">
              <span>Working price</span>
              <strong>
                <PricePill value={currentWorkingPrice.value} unit={currentWorkingPrice.unit} />
              </strong>
              <small>
                {currentWorkingPrice.sourceLabel}
                {currentWorkingPrice.ageMs == null ? "" : ` · ${formatAge(currentWorkingPrice.ageMs)}`}
              </small>
            </div>

            <div className="manual-price-row">
              <input
                inputMode="decimal"
                min="0"
                onChange={(event) => setDraftPrice(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") applyManualPrice();
                }}
                placeholder="e.g. 240"
                type="number"
                value={draftPrice}
              />
              <select value={draftUnit} onChange={(event) => setDraftUnit(event.target.value)}>
                <option value="exalted">Exalted Orb</option>
                <option value="divine">Divine Orb</option>
              </select>
              <button type="button" onClick={applyManualPrice}>Apply</button>
              <button className="ghost" type="button" onClick={clearManualPrice}>Use hourly</button>
            </div>

            {guidance.status === "ok" && entry != null && exit != null ? (
              <div className="guidance-grid">
                <article>
                  <span>Buy / enter at or below</span>
                  <strong><PricePill value={entry} unit={guidanceUnit} /></strong>
                  <small>{formatPercent(guidance.entryDiscount)} vs working price</small>
                </article>
                <article>
                  <span>Sell / exit at or above</span>
                  <strong><PricePill value={exit} unit={guidanceUnit} /></strong>
                  <small>{formatPercent(guidance.exitPremium)} vs working price</small>
                </article>
                <article>
                  <span>Historical hit rate</span>
                  <strong>{formatPercent(guidance.hitRate, { signed: false, maximumFractionDigits: 0 })}</strong>
                  <small>{guidance.horizonSamples || guidance.samples} rolling {horizon}h windows</small>
                </article>
                <article>
                  <span>Median time to hit</span>
                  <strong>{formatDurationHours(guidance.medianTimeToHitHours)}</strong>
                  <small>when the exit was reached</small>
                </article>
              </div>
            ) : (
              <p className="guidance-empty">
                {guidance.status === "insufficient-history"
                  ? `Not enough completed-hour history yet (${guidance.samples ?? 0}/3).`
                  : "Enter a current price, or wait for a usable hourly midpoint."}
              </p>
            )}
          </section>
        )}
      </div>
    </section>
  );
}
