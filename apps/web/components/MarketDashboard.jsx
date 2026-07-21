"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import SpotChart from "./SpotChart.jsx";
import { roundTripGold } from "../../../src/domain/gold-costs.js";
import { keyCurrencyCards, sparklinePoints } from "../lib/key-currencies.js";
import { currentPriceGuidance, quoteFromAnchor, workingPrice } from "../lib/price-guidance.js";
import {
  apiBaseUrl,
  displayDigits,
  fallbackIconUrl,
  fetchJsonWithRetry,
  formatAge,
  formatDurationHours,
  formatNumber,
  formatPercent,
  iconUrl,
  titleize,
} from "../lib/market.js";

const MANUAL_PRICE_KEY = "poe2flip.next.manualPrices.v2";
const CATEGORY_ICON_IDS = {
  "Abyssal Bones": "gnawed-jawbone",
  Breach: "breach-splinter",
  Currency: "exalted",
  Delirium: "simulacrum-splinter",
  Essences: "essence-of-horror",
  Expedition: "expedition-logbook",
  Fragments: "runic-splinter",
  "Lineage Support Gems": "ataluis-bloodletting",
  Ritual: "omen-of-refreshment",
  Runes: "storm-rune",
  Vaal: "vaal",
  Verisium: "verisium",
  Waystones: "waystone-16",
};
const SORT_OPTIONS = [
  { value: "spread:desc", label: "Best profit" },
  { value: "activity:desc", label: "Activity" },
  { value: "buy:asc", label: "Buy: cheapest first" },
  { value: "sell:desc", label: "Sell: highest first" },
  { value: "price:desc", label: "Price: high to low" },
  { value: "price:asc", label: "Price: low to high" },
  { value: "movement:desc", label: "24h gainers" },
  { value: "movement:asc", label: "24h losers" },
  { value: "liquidity:desc", label: "Liquidity" },
  { value: "name:asc", label: "Name" },
];
const HORIZON_OPTIONS = [
  { value: 1, label: "1h" },
  { value: 2, label: "2h" },
  { value: 6, label: "6h" },
  { value: 16, label: "16h" },
  { value: 24, label: "24h" },
];
const DISPLAY_CURRENCIES = [
  { id: "exalted", label: "Exalted Orb" },
  { id: "chaos", label: "Chaos Orb" },
  { id: "divine", label: "Divine Orb" },
];

/** Swap a missing/not-yet-downloaded GGG icon for the neutral committed glyph. */
function onIconError(event) {
  const img = event.currentTarget;
  if (img.src.endsWith("_fallback.svg")) return;
  img.onerror = null;
  img.src = fallbackIconUrl;
}

function PricePill({ value, unit, compact = false }) {
  if (!unit || !Number.isFinite(value)) return <span className="price-pill empty">—</span>;
  return (
    <span className={compact ? "price-pill compact" : "price-pill"}>
      <span>{formatNumber(value, { maximumFractionDigits: displayDigits(value) })}</span>
      <img src={iconUrl(unit)} onError={onIconError} alt="" title={titleize(unit)} />
    </span>
  );
}

function QuotePill({ quote, compact = false }) {
  if (!quote || !Number.isFinite(quote.value)) return <span className="price-pill empty">—</span>;
  return <PricePill value={quote.value} unit={quote.unit} compact={compact} />;
}

function KeyCurrencyCard({ card }) {
  const points = sparklinePoints(card.values);
  const direction = (card.movement ?? 0) >= 0 ? "up" : "down";
  return (
    <article className="key-currency-card">
      <div className="key-currency-card-head">
        <span className="key-currency-name">
          <img src={iconUrl(card.id)} onError={onIconError} alt="" />
          <span>
            <strong>{card.name}</strong>
            <small>{card.unit ? `${titleize(card.unit)} per ${titleize(card.id)}` : "Hourly market rate"}</small>
          </span>
        </span>
        <span className={`key-currency-move ${direction}`}>{formatPercent(card.movement)}</span>
      </div>
      <div className="key-currency-card-body">
        {card.available ? <PricePill value={card.value} unit={card.unit} /> : <span className="key-currency-empty">Waiting for data</span>}
        {points ? (
          <svg className={`key-currency-spark ${direction}`} viewBox="0 0 180 54" role="img" aria-label={`${card.name} 24 hour chart`}>
            <path className="key-currency-grid-line" d="M3 14 H177 M3 27 H177 M3 40 H177" />
            <polyline points={points} />
          </svg>
        ) : (
          <span className="key-currency-spark-empty" aria-hidden="true" />
        )}
      </div>
    </article>
  );
}

function pricePlaceholder(value) {
  return Number.isFinite(value) ? formatNumber(value, { maximumFractionDigits: displayDigits(value) }) : "price";
}

function unitRates(rows, divineInExalted) {
  const chaos = rows.find((row) => row.target === "chaos");
  return {
    exalted: 1,
    chaos: Number.isFinite(chaos?.reference) && chaos.reference > 0 ? chaos.reference : null,
    divine: Number.isFinite(divineInExalted) && divineInExalted > 0 ? divineInExalted : null,
  };
}

function CustomSelect({ id, value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const selected = options.find((option) => String(option.value) === String(value)) ?? options[0];

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event) {
      if (!ref.current?.contains(event.target)) setOpen(false);
    }
    function onKeyDown(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className={open ? "custom-select open" : "custom-select"} ref={ref}>
      <button
        id={`${id}-button`}
        type="button"
        className="custom-select-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((next) => !next)}
      >
        <span>{selected?.label ?? "Select"}</span>
        <span className="custom-select-caret" aria-hidden="true" />
      </button>
      {open && (
        <div className="custom-select-menu" role="listbox" aria-labelledby={`${id}-button`}>
          {options.map((option) => (
            <button
              key={String(option.value)}
              type="button"
              role="option"
              aria-selected={String(option.value) === String(value)}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function rowSpread(row) {
  if (!Number.isFinite(row?.low) || !Number.isFinite(row?.high) || row.low <= 0 || row.high <= row.low) return null;
  return row.high / row.low - 1;
}

/**
 * Gold-aware metrics for a one-unit round-trip flip (buy 1 target at the range
 * low, sell it back at the range high). Uses the SAME domain gold model as the
 * paper-trade engine — nothing is invented here. `profitPer100k` is the
 * quantity-independent wedge metric (anchor profit per 100k gold spent); it is
 * exactly what free tools never show. Returns nulls when the range or a gold
 * cost is unknown, so the column shows "—" rather than a fabricated number.
 */
function goldMetrics(row, goldPerAnchor) {
  const goldPerTarget = row?.gold?.goldPerUnit;
  const goldAnchor = Number.isFinite(goldPerAnchor) ? goldPerAnchor : goldPerTarget;
  const { low, high } = row ?? {};
  if (!Number.isFinite(goldPerTarget) || !Number.isFinite(low) || !Number.isFinite(high) || low <= 0 || high <= low) {
    return { goldPerFlip: null, profitPer100k: null };
  }
  const { totalGold } = roundTripGold({
    receivedTarget: 1, // buy 1 target unit → gold charged on the 1 received
    receivedAnchorOnExit: high, // sell it → receive `high` anchor → gold on that
    goldPerTarget,
    goldPerAnchor: goldAnchor,
  });
  const profit = high - low; // anchor profit per unit flipped
  return {
    goldPerFlip: totalGold,
    profitPer100k: Number.isFinite(totalGold) && totalGold > 0 ? (profit / totalGold) * 100_000 : null,
  };
}

/**
 * Hover text for the Profit cell — moves the gold-efficiency detail out of a
 * dedicated column and into a tooltip: exalted profit per 100k gold of trade
 * tax, plus the raw gold cost of one round-trip flip. Falls back gracefully
 * when gold data is missing.
 */
function goldTooltip(row) {
  const parts = ["Buy at the range low, sell at the range high."];
  if (Number.isFinite(row?._profitPer100k)) {
    parts.push(`≈ ${formatNumber(row._profitPer100k, { maximumFractionDigits: 1 })} exalted profit per 100,000 gold of trade tax.`);
  }
  if (Number.isFinite(row?._goldPerFlip)) {
    parts.push(`Gold cost per 1-unit flip ≈ ${formatNumber(row._goldPerFlip, { maximumFractionDigits: 0 })} (placeholder).`);
  }
  return parts.join(" ");
}

/**
 * Qualitative liquidity band from the visible-market volume terciles, so the
 * "High / Medium / Low" label is data-driven (relative to the current universe)
 * rather than a hard-coded threshold pretending to be absolute truth.
 */
function liquidityBand(volume, thresholds) {
  if (!Number.isFinite(volume) || !thresholds) return null;
  if (volume >= thresholds.p66) return "high";
  if (volume >= thresholds.p33) return "med";
  return "low";
}

function liquidityLabel(volume, thresholds) {
  const band = liquidityBand(volume, thresholds);
  return band === "high" ? "High" : band === "med" ? "Medium" : band === "low" ? "Low" : "—";
}

function sortValue(row, key) {
  if (key === "profit100k") return row._profitPer100k;
  if (key === "activity") return row.activityScore;
  if (key === "spread") return rowSpread(row);
  if (key === "buy") return row.low;
  if (key === "sell") return row.high;
  if (key === "price") return row.reference;
  if (key === "movement") return row.movement?.h24;
  if (key === "liquidity") return row.volume;
  if (key === "name") return row.targetName ?? row.target ?? "";
  return row.activityScore;
}

function compareRows(a, b, sortToken) {
  const [key, direction = "desc"] = sortToken.split(":");
  const av = sortValue(a, key);
  const bv = sortValue(b, key);
  const multiplier = direction === "asc" ? 1 : -1;
  if (typeof av === "string" || typeof bv === "string") {
    return String(av ?? "").localeCompare(String(bv ?? "")) * multiplier;
  }
  const aFinite = Number.isFinite(av);
  const bFinite = Number.isFinite(bv);
  if (!aFinite && !bFinite) return 0;
  if (!aFinite) return 1;
  if (!bFinite) return -1;
  return (av - bv) * multiplier;
}

function SortHeader({ label, sublabel, column, activeKey, direction, onSort, align = "left", defaultDirection = "desc", title }) {
  const active = activeKey === column;
  return (
    <button type="button" title={title} className={`sort-header ${align === "right" ? "right" : ""}`} onClick={() => onSort(column, defaultDirection)}>
      <span>
        {label}
        {sublabel && <small>{sublabel}</small>}
      </span>
      <svg className={active ? `sort-glyph ${direction}` : "sort-glyph"} viewBox="0 0 16 16" aria-hidden="true">
        <path className="chev-up" d="M4.5 7 L8 3.8 L11.5 7" />
        <path className="chev-down" d="M4.5 9 L8 12.2 L11.5 9" />
      </svg>
    </button>
  );
}

/** Group tradable rows into { name, count } category buckets for the sidebar. */
function categoriesFrom(rows) {
  const counts = new Map();
  const icons = new Map();
  for (const row of rows) {
    const name = row.category || "Other";
    counts.set(name, (counts.get(name) ?? 0) + 1);
    if (!icons.has(name) && row.target) icons.set(name, row.target);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count, icon: CATEGORY_ICON_IDS[name] ?? icons.get(name) ?? null }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function manualPriceKey(game, league) {
  return `${MANUAL_PRICE_KEY}:${game ?? "poe2"}:${league ?? "default"}`;
}

function loadManualPrices(game, league) {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(manualPriceKey(game, league)) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveManualPrices(game, league, prices) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(manualPriceKey(game, league), JSON.stringify(prices));
}

export default function MarketDashboard({ initialGame = "poe2" }) {
  const [marketConfig, setMarketConfig] = useState(null);
  const [game, setGame] = useState(initialGame);
  const [league, setLeague] = useState(null);
  const [radar, setRadar] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedPair, setSelectedPair] = useState(null);
  const [status, setStatus] = useState("loading");
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("activity:desc");
  const [category, setCategory] = useState("all");
  const [displayCurrency, setDisplayCurrency] = useState(null);
  const [view, setView] = useState("list"); // "list" (table, default) | "chart" (trade view)
  const [horizon, setHorizon] = useState(6);
  const [manualPrices, setManualPrices] = useState({});
  const [draftPrice, setDraftPrice] = useState("");
  const [draftUnit, setDraftUnit] = useState("exalted");

  useEffect(() => {
    let cancelled = false;
    fetchJsonWithRetry(`${apiBaseUrl}/api/config`, { cache: "no-store" })
      .then((data) => {
        if (cancelled) return;
        const requestedGame =
          typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("game") : null;
        const selectedGame = data.games?.find((entry) => entry.id === (requestedGame ?? initialGame) && entry.enabled)
          ?? data.games?.find((entry) => entry.enabled);
        if (!selectedGame) throw new Error("No game is configured");
        const leagues = (selectedGame.leagues ?? []).filter((entry) => entry.enabled);
        const requested =
          typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("league") : null;
        const initial = leagues.some((entry) => entry.id === requested)
          ? requested
          : selectedGame?.activeLeague ?? data.league ?? leagues[0]?.id;
        if (!initial) throw new Error("No league is configured");
        setMarketConfig(data);
        setGame(selectedGame.id);
        setLeague(initial);
      })
      .catch((error) => {
        if (!cancelled) setStatus(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [initialGame, reloadKey]);

  useEffect(() => {
    if (!league) return;
    setManualPrices(loadManualPrices(game, league));
  }, [game, league]);

  useEffect(() => {
    if (!league) return undefined;
    let cancelled = false;
    setStatus("loading");
    setRadar(null);
    setSelectedPair(null);
    const params = new URLSearchParams({ anchor: "exalted", game, league });
    fetchJsonWithRetry(`${apiBaseUrl}/api/radar?${params}`, { cache: "no-store" })
      .then((data) => {
        if (cancelled) return;
        setRadar(data);
        const tradable = (data.rows ?? []).filter((row) => row.pairId && row.status !== "no-trades-this-hour");
        // Deep-link from the SEO currency pages: /poe2?currency=divine preselects
        // that market if it's tradable this hour, else fall back to the first row.
        const wanted = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("currency") : null;
        const preferred = wanted ? tradable.find((row) => row.target === wanted) : null;
        setSelectedPair((preferred ?? tradable[0])?.pairId ?? null);
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
  }, [game, league, reloadKey]);

  useEffect(() => {
    if (!selectedPair || !league) return;
    let cancelled = false;
    // Clear immediately so a market switch never renders the previous market's
    // chart/guidance under the new title while the new history is in flight.
    setHistory([]);
    setHistoryLoading(true);
    const params = new URLSearchParams({ pair: selectedPair, anchor: "exalted", game, league });
    fetch(`${apiBaseUrl}/api/radar/history?${params}`, { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`History failed: ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setHistory(data.series ?? []);
      })
      .catch(() => {
        if (!cancelled) setHistory([]);
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [game, selectedPair, league]);

  // Plan modal: Escape closes it and background scroll is locked while it is open.
  useEffect(() => {
    if (view !== "chart") return undefined;
    function onKeyDown(event) {
      if (event.key === "Escape") setView("list");
    }
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [view]);

  // All tradable rows (a real pair, traded this hour) — the radar universe.
  const tradable = useMemo(
    () => (radar?.rows ?? []).filter((row) => row.pairId && row.status !== "no-trades-this-hour"),
    [radar],
  );
  const rates = useMemo(() => unitRates(tradable, radar?.units?.divineInExalted), [radar?.units?.divineInExalted, tradable]);
  const manualUnit = displayCurrency && rates[displayCurrency] ? displayCurrency : "exalted";

  // Volume terciles across the tradable universe → qualitative liquidity band.
  const liquidityThresholds = useMemo(() => {
    const vols = tradable
      .map((row) => row.volume)
      .filter((v) => Number.isFinite(v) && v > 0)
      .sort((a, b) => a - b);
    if (vols.length < 3) return null;
    return { p33: vols[Math.floor(vols.length * 0.33)], p66: vols[Math.floor(vols.length * 0.66)] };
  }, [tradable]);

  // Search narrows the universe; the category sidebar counts reflect the search.
  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tradable;
    return tradable.filter((row) => row.targetName?.toLowerCase().includes(q) || row.target?.toLowerCase().includes(q));
  }, [tradable, search]);

  const categories = useMemo(() => categoriesFrom(searched), [searched]);

  // If the active category vanishes from the (search-narrowed) list, fall back to
  // "all" so the table can't stay filtered to a category the sidebar no longer shows.
  useEffect(() => {
    if (category !== "all" && !categories.some((cat) => cat.name === category)) setCategory("all");
  }, [categories, category]);

  const goldPerAnchor = radar?.goldPerAnchor;
  const rows = useMemo(() => {
    const inCategory = category === "all" ? searched : searched.filter((row) => (row.category || "Other") === category);
    // Attach gold-aware metrics once, so the table cells and the sort read the
    // same computed values (no double computation, no drift).
    const enriched = inCategory.map((row) => {
      const { goldPerFlip, profitPer100k } = goldMetrics(row, goldPerAnchor);
      return { ...row, _goldPerFlip: goldPerFlip, _profitPer100k: profitPer100k };
    });
    return enriched.sort((a, b) => compareRows(a, b, sort)).slice(0, 200);
  }, [searched, category, sort, goldPerAnchor]);

  const selected = selectedPair
    ? rows.find((row) => row.pairId === selectedPair) ?? tradable.find((row) => row.pairId === selectedPair) ?? null
    : null;
  const [sortKey, sortDirection = "desc"] = sort.split(":");

  // Freshness context for the trade modal header/plan.
  const freshnessAgeMs = radar?.generatedAt ? Date.now() - Date.parse(radar.generatedAt) : null;
  const freshness = Number.isFinite(freshnessAgeMs)
    ? freshnessAgeMs < 60_000 ? "just now" : formatAge(freshnessAgeMs)
    : null;

  function openMarket(pairId) {
    setSelectedPair(pairId);
    setView("chart");
  }

  function closeMarket() {
    setView("list");
  }

  function sortColumn(column, defaultDirection = "desc") {
    setSort((current) => {
      const [currentKey, currentDirection = defaultDirection] = current.split(":");
      if (currentKey !== column) return `${column}:${defaultDirection}`;
      return `${column}:${currentDirection === "desc" ? "asc" : "desc"}`;
    });
  }

  function selectLeague(nextLeague) {
    if (!nextLeague || nextLeague === league) return;
    setSelectedPair(null);
    setLeague(nextLeague);
    setCategory("all");
    setView("list");
    setHistory([]);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("league", nextLeague);
      window.history.replaceState({}, "", url);
    }
  }

  function selectGame(nextGame) {
    if (!nextGame || nextGame === game) return;
    const selectedGame = marketConfig?.games?.find((entry) => entry.id === nextGame && entry.enabled);
    const nextLeague = selectedGame?.activeLeague ?? selectedGame?.leagues?.find((entry) => entry.enabled)?.id;
    if (!selectedGame || !nextLeague) return;
    setGame(nextGame);
    setLeague(nextLeague);
    setSelectedPair(null);
    setCategory("all");
    setSearch("");
    setView("list");
    setHistory([]);
    setDisplayCurrency(null);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.pathname = nextGame === "poe1" ? "/poe1" : "/poe2";
      url.searchParams.set("game", nextGame);
      url.searchParams.set("league", nextLeague);
      url.searchParams.delete("currency");
      window.history.replaceState({}, "", url);
    }
  }

  const selectedManual = selected?.pairId ? manualPrices[selected.pairId] : null;
  const currentWorkingPrice = selected
    ? workingPrice(selected, selectedManual, {
      divineInExalted: radar?.units?.divineInExalted,
      chaosInExalted: rates.chaos,
      preferredUnit: manualUnit,
    })
    : { status: "missing", value: null, unit: null, anchorValue: null };
  const guidance = useMemo(
    () => currentPriceGuidance(history, currentWorkingPrice.anchorValue, { horizonHours: horizon }),
    [currentWorkingPrice.anchorValue, history, horizon],
  );
  const planSpread = guidance.status === "ok" ? guidance.rangePotential : null;
  const planMetrics = selected && guidance.status === "ok"
    ? goldMetrics({ ...selected, low: guidance.entry, high: guidance.exit }, goldPerAnchor)
    : null;
  const chartUnit = displayCurrency && rates[displayCurrency] ? displayCurrency : selected?.anchor ?? "exalted";
  const chartHistory = useMemo(() => {
    if (!rates[selected?.anchor] || !rates[chartUnit]) return history;
    const factor = rates[selected.anchor] / rates[chartUnit];
    return history.map((point) => ({
      ...point,
      reference: Number.isFinite(point.reference) ? point.reference * factor : point.reference,
      low: Number.isFinite(point.low) ? point.low * factor : point.low,
      high: Number.isFinite(point.high) ? point.high * factor : point.high,
    }));
  }, [chartUnit, history, rates, selected?.anchor]);
  const workingQuote = selected
    ? quoteFromAnchor(currentWorkingPrice.anchorValue, { anchor: selected.anchor, displayCurrency, rates, target: selected.target })
    : null;
  const entryQuote = guidance.status === "ok"
    ? quoteFromAnchor(guidance.entry, { anchor: selected?.anchor, displayCurrency, rates, target: selected?.target })
    : null;
  const exitQuote = guidance.status === "ok"
    ? quoteFromAnchor(guidance.exit, { anchor: selected?.anchor, displayCurrency, rates, target: selected?.target })
    : null;

  useEffect(() => {
    if (!selected) return;
    const saved = manualPrices[selected.pairId];
    if (saved?.value && saved?.unit) {
      setDraftPrice(String(saved.value));
      setDraftUnit(saved.unit);
    } else {
      const fallbackUnit = manualUnit;
      setDraftPrice("");
      setDraftUnit(fallbackUnit);
    }
  }, [manualPrices, manualUnit, selected]);

  function applyManualPrice() {
    if (!selected?.pairId) return;
    const value = Number(String(draftPrice).replace(",", "."));
    const next = { ...manualPrices };
    if (Number.isFinite(value) && value > 0 && rates[draftUnit]) {
      next[selected.pairId] = { value, unit: draftUnit, updatedAt: Date.now() };
    } else {
      delete next[selected.pairId];
    }
    setManualPrices(next);
    saveManualPrices(game, league, next);
  }

  function clearManualPrice() {
    if (!selected?.pairId) return;
    const next = { ...manualPrices };
    delete next[selected.pairId];
    setManualPrices(next);
    saveManualPrices(game, league, next);
  }

  const gameOptions = marketConfig?.games?.filter((entry) => entry.enabled) ?? [];
  const leagueOptions =
    marketConfig?.games
      ?.find((entry) => entry.id === game)
      ?.leagues?.filter((entry) => entry.enabled)
      .map((entry) => ({ value: entry.id, label: entry.label })) ?? [];
  const keyCurrencies = useMemo(() => keyCurrencyCards(tradable), [tradable]);
  const sourceMode = radar?.source?.sourceMode;
  // On ready we show no subtitle — the header stays clean. Loading/error states
  // still surface a short status line. (Placeholder-gold honesty lives on the
  // "unofficial" eyebrow and the Profit tooltip, so nothing is misrepresented.)
  // Error text is surfaced in the table's error card (with a retry), so the
  // header subtitle only carries the loading hint — never a raw error string.
  const summaryText = status === "loading" ? "Loading completed-hour history…" : "";

  return (
    <div className="radar-light">
      <section className="radar-shell">
        <aside className="radar-sidebar" aria-label="Market navigation">
          <div className="rs-group">
            <p className="rs-heading">Workspace</p>
            <button className="rs-link active" type="button" aria-pressed="true">
              <span className="rs-icon" aria-hidden="true">⌁</span>
              <span>Market Radar</span>
            </button>
          </div>
          <div className="rs-group rs-categories">
            <p className="rs-heading">Categories</p>
            <button
              className={category === "all" ? "rs-cat active" : "rs-cat"}
              type="button"
              aria-pressed={category === "all"}
              onClick={() => setCategory("all")}
            >
              <img className="rs-cat-icon" src={iconUrl("exalted")} onError={onIconError} alt="" aria-hidden="true" />
              <span>All markets</span>
              <small>{searched.length}</small>
            </button>
            {categories.map((cat) => (
              <button
                key={cat.name}
                className={category === cat.name ? "rs-cat active" : "rs-cat"}
                type="button"
                aria-pressed={category === cat.name}
                onClick={() => setCategory(cat.name)}
              >
                <img className="rs-cat-icon" src={iconUrl(cat.icon)} onError={onIconError} alt="" aria-hidden="true" />
                <span className="rs-cat-name">{cat.name}</span>
                <small>{cat.count}</small>
              </button>
            ))}
          </div>
          <p className="rs-foot">Categories come from the current GGG trade catalog.</p>
        </aside>

        <div className="radar-main">
          <header className="radar-head">
            <div>
              <div className="radar-title-meta">
                <p className="eyebrow">{league ? `${league} · ` : ""}hourly market digest · unofficial</p>
                {sourceMode && (
                  <span className={`data-source-badge ${sourceMode}`}>
                    {sourceMode === "official" ? "Official GGG data" : "Sample fixture data"}
                  </span>
                )}
              </div>
              <h2>What is moving today</h2>
              {summaryText && <p className="radar-sub">{summaryText}</p>}
            </div>
            <div className="radar-head-actions">
              {gameOptions.length > 1 && (
                <div className="game-control">
                  <span>Game</span>
                  <div className="game-toggle" role="group" aria-label="Game">
                    {gameOptions.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        aria-pressed={game === option.id}
                        onClick={() => selectGame(option.id)}
                      >
                        {option.id === "poe1" ? "PoE 1" : "PoE 2"}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {league && leagueOptions.length > 1 && (
                <div className="league-control">
                  <span>League</span>
                  <CustomSelect id="league" value={league} options={leagueOptions} onChange={selectLeague} />
                </div>
              )}
              <div className="currency-toggle" role="group" aria-label="Display currency">
                <button
                  type="button"
                  className="auto"
                  aria-pressed={!displayCurrency}
                  title="Auto display currency"
                  onClick={() => setDisplayCurrency(null)}
                >
                  Auto
                </button>
                {DISPLAY_CURRENCIES.map((currency) => (
                  <button
                    key={currency.id}
                    type="button"
                    aria-pressed={displayCurrency === currency.id}
                    title={currency.label}
                    onClick={() => setDisplayCurrency((current) => (current === currency.id ? null : currency.id))}
                    disabled={currency.id !== "exalted" && !rates[currency.id]}
                  >
                    <img src={iconUrl(currency.id)} onError={onIconError} alt="" />
                  </button>
                ))}
              </div>
              <div className="radar-view-toggle" role="group" aria-label="Radar display">
                <button type="button" aria-pressed={view === "list"} onClick={closeMarket}>
                  Table
                </button>
                <button
                  type="button"
                  aria-pressed={view === "chart"}
                  onClick={() => setView("chart")}
                  disabled={!selected}
                >
                  Trade view
                </button>
              </div>
            </div>
          </header>

          <section className="key-currencies" aria-labelledby="key-currencies-title">
            <div className="key-currencies-heading">
              <div>
                <p className="eyebrow">Core market</p>
                <h3 id="key-currencies-title">Key currency rates</h3>
              </div>
              <span>Last 24 completed hours</span>
            </div>
            <div className="key-currency-grid">
              {keyCurrencies.map((card) => <KeyCurrencyCard key={card.id} card={card} />)}
            </div>
          </section>

          <div className="radar-controls">
            <label className="rc-search">
              <span>Search markets</span>
              <span className="rc-search-box">
                <svg className="rc-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" />
                  <line x1="16.5" y1="16.5" x2="21" y2="21" />
                </svg>
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Currency, rune, essence…" type="search" />
              </span>
            </label>
            <span className="rc-count" aria-live="polite">{rows.length} markets</span>
          </div>

          <div className="radar-table-wrap">
              <table className="radar-table">
                <thead>
                  <tr>
                    <th scope="col">
                      <SortHeader label="Item" sublabel="market" column="name" activeKey={sortKey} direction={sortDirection} onSort={sortColumn} defaultDirection="asc" />
                    </th>
                    <th className="right" scope="col">
                      <SortHeader label="Buy price" sublabel="(low)" column="buy" activeKey={sortKey} direction={sortDirection} onSort={sortColumn} align="right" defaultDirection="asc" />
                    </th>
                    <th className="right" scope="col">
                      <SortHeader label="Sell price" sublabel="(high)" column="sell" activeKey={sortKey} direction={sortDirection} onSort={sortColumn} align="right" />
                    </th>
                    <th className="right" scope="col">
                      <SortHeader
                        label="Profit"
                        sublabel="(buy → sell)"
                        title="Return on the flip: buy at the range low, sell at the range high. Hover a row for the gold-efficiency detail (exalted profit per 100k gold of trade tax)."
                        column="spread"
                        activeKey={sortKey}
                        direction={sortDirection}
                        onSort={sortColumn}
                        align="right"
                      />
                    </th>
                    <th className="right" scope="col">
                      <SortHeader label="Trend 24h" column="movement" activeKey={sortKey} direction={sortDirection} onSort={sortColumn} align="right" />
                    </th>
                    <th className="right" scope="col">
                      <SortHeader label="Liquidity" column="liquidity" activeKey={sortKey} direction={sortDirection} onSort={sortColumn} align="right" />
                    </th>
                    <th className="right" scope="col">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const move = row.movement?.h24;
                    const spread = rowSpread(row);
                    return (
                      <tr
                        key={row.pairId}
                        className={row.pairId === selected?.pairId ? "active" : ""}
                        onClick={() => openMarket(row.pairId)}
                      >
                        <td className="cell-item">
                          <img src={iconUrl(row.target)} onError={onIconError} alt="" loading="lazy" />
                          <span>
                            <strong>{row.targetName}</strong>
                            <small>{row.category || "Other"}</small>
                          </span>
                        </td>
                        <td className="right">
                          <QuotePill quote={quoteFromAnchor(row.low, { anchor: row.anchor, displayCurrency, rates, target: row.target })} compact />
                        </td>
                        <td className="right">
                          <QuotePill quote={quoteFromAnchor(row.high, { anchor: row.anchor, displayCurrency, rates, target: row.target })} compact />
                        </td>
                        <td className="right cell-profit">
                          {Number.isFinite(spread) ? (
                            <strong className="profit-pos" title={goldTooltip(row)}>
                              {formatPercent(spread, { signed: false })}
                            </strong>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className={`right ${(move ?? 0) >= 0 ? "up" : "down"}`}>{formatPercent(move)}</td>
                        <td className="right">{Number.isFinite(row.volume) ? formatNumber(row.volume, { maximumFractionDigits: 0 }) : "—"}</td>
                        <td className="right">
                          <button
                            type="button"
                            className="row-action"
                            onClick={(event) => {
                              event.stopPropagation();
                              openMarket(row.pairId);
                            }}
                          >
                            Plan
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {!rows.length && status === "loading" &&
                    Array.from({ length: 8 }).map((_, index) => (
                      <tr className="skeleton-row" key={`skeleton-${index}`} aria-hidden="true">
                        <td className="cell-item">
                          <span className="sk sk-icon" />
                          <span className="sk-lines">
                            <span className="sk sk-line" />
                            <span className="sk sk-line short" />
                          </span>
                        </td>
                        <td className="right"><span className="sk sk-pill" /></td>
                        <td className="right"><span className="sk sk-pill" /></td>
                        <td className="right"><span className="sk sk-pill narrow" /></td>
                        <td className="right"><span className="sk sk-pill narrow" /></td>
                        <td className="right"><span className="sk sk-pill narrow" /></td>
                        <td className="right"><span className="sk sk-pill narrow" /></td>
                      </tr>
                    ))}
                  {!rows.length && status !== "loading" && (
                    <tr>
                      <td className="empty-state" colSpan={7}>
                        {status === "ready" ? (
                          "No markets match this filter."
                        ) : (
                          <div className="radar-error" role="alert">
                            <strong>Market radar is temporarily unavailable.</strong>
                            <span>{status}</span>
                            <button type="button" className="radar-retry" onClick={() => setReloadKey((key) => key + 1)}>
                              Try again
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
          </div>

          {view === "chart" && selected && (
            <div className="rt-modal-backdrop" role="presentation" onClick={closeMarket}>
              <div
                className="rt-modal"
                role="dialog"
                aria-modal="true"
                aria-label={`Trade plan for ${selected?.targetName ?? "market"}`}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="radar-trade">
              <header className="rt-head">
                <div className="rt-head-id">
                  <img src={iconUrl(selected.target)} onError={onIconError} alt="" />
                  <div>
                    <strong>{selected.targetName}</strong>
                    <span>{selected.category || "Market"}</span>
                  </div>
                </div>
                <div className="rt-head-metrics">
                  <div className="rt-metric">
                    <strong className="rt-price">
                      <QuotePill quote={quoteFromAnchor(selected.reference, { anchor: selected.anchor, displayCurrency, rates, target: selected.target })} compact />
                    </strong>
                    <small className={(selected.movement?.h24 ?? 0) >= 0 ? "up" : "down"}>{formatPercent(selected.movement?.h24)} · 24h</small>
                  </div>
                  <div className="rt-metric">
                    <strong>{Number.isFinite(selected.volume) ? formatNumber(selected.volume, { maximumFractionDigits: 0 }) : "—"}</strong>
                    <small className={`liq-${liquidityBand(selected.volume, liquidityThresholds) ?? "na"}`}>
                      {liquidityLabel(selected.volume, liquidityThresholds)} liquidity
                    </small>
                  </div>
                  {freshness && (
                    <div className="rt-metric rt-metric-fresh">
                      <small>Updated {freshness}</small>
                    </div>
                  )}
                </div>
                <div className="rt-head-controls">
                  <button
                    type="button"
                    className="trade-close-button"
                    aria-label="Close trade plan"
                    title="Close"
                    onClick={closeMarket}
                  >
                    ×
                  </button>
                </div>
              </header>
              <div className="rt-chart">
                <div className="chart-title-row">
                  <h3>{selected.targetName} / {titleize(chartUnit)}</h3>
                  <div className="horizon-segments" role="group" aria-label="Chart timeframe">
                    {HORIZON_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={horizon === option.value}
                        onClick={() => setHorizon(option.value)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
                <SpotChart points={chartHistory} bucketHours={horizon} loading={historyLoading} />
                <p className="rt-note">Range-derived from official hourly low/high — context, not a tick-level feed.</p>
              </div>

              {selected && (
                <aside className="rt-plan" aria-label="Trade guidance">
                  <div className="guidance-header">
                    <div>
                      <h3>Trade plan</h3>
                      <p className="rt-subtle">{currentWorkingPrice.source === "manual" ? "Using your live price" : "Using hourly midpoint"}</p>
                    </div>
                  </div>

                  {historyLoading ? (
                    <div className="rt-plan-loading">
                      <span className="rt-spinner" aria-label="Loading trade plan" />
                    </div>
                  ) : guidance.status === "ok" && entryQuote?.value != null && exitQuote?.value != null ? (
                    <>
                      <div className="trade-answer">
                        <article className="buy">
                          <span className="ta-head">Buy<i className="ta-arrow" aria-hidden="true">→</i></span>
                          <strong><QuotePill quote={entryQuote} /></strong>
                          <small>{formatPercent(Math.abs(guidance.entryDiscount), { signed: false })} below working price</small>
                        </article>
                        <article className="sell">
                          <span className="ta-head">Sell<i className="ta-arrow" aria-hidden="true">→</i></span>
                          <strong><QuotePill quote={exitQuote} /></strong>
                          <small>{formatPercent(guidance.exitPremium, { signed: false })} above working price</small>
                        </article>
                      </div>

                      <div className="working-price-line">
                        <span>Working price</span>
                        <strong><QuotePill quote={workingQuote} compact /></strong>
                        <small>{currentWorkingPrice.sourceLabel}{currentWorkingPrice.ageMs == null ? "" : ` · ${formatAge(currentWorkingPrice.ageMs)}`}</small>
                      </div>

                      {Number.isFinite(planSpread) && (
                        <p className="rt-gold-caption">
                          <strong>{formatPercent(planSpread, { signed: false })} margin</strong>
                          {Number.isFinite(planMetrics?.profitPer100k)
                            ? ` · ≈ ${formatNumber(planMetrics.profitPer100k, { maximumFractionDigits: 1 })} ex / 100k gold`
                            : ""}
                        </p>
                      )}

                      <p className="rt-section-label">Seeing a different price in-game?</p>
                      <p className="rt-hint">Data lags ~1h. Enter the price you see now and the plan re-computes against it.</p>
                      <div className="manual-price-row">
                        <label>
                          Live price
                          <input
                            inputMode="decimal"
                            onChange={(event) => setDraftPrice(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") applyManualPrice();
                            }}
                            placeholder={pricePlaceholder(currentWorkingPrice.value)}
                            type="text"
                            value={draftPrice}
                          />
                        </label>
                        <span className="manual-price-unit">{titleize(draftUnit)}</span>
                        <button type="button" onClick={applyManualPrice}>Update plan</button>
                        {currentWorkingPrice.source === "manual" && (
                          <button className="ghost" type="button" onClick={clearManualPrice}>Reset</button>
                        )}
                      </div>

                      <p className="rt-section-label">Live stats</p>
                      <div className="guidance-grid compact">
                        <article>
                          <span>Reached sell price</span>
                          <strong>{formatPercent(guidance.hitRate, { signed: false, maximumFractionDigits: 0 })}</strong>
                          <small>{guidance.horizonSamples || guidance.samples} rolling {horizon}h windows</small>
                        </article>
                        <article>
                          <span>Usual wait</span>
                          <strong>{formatDurationHours(guidance.medianTimeToHitHours)}</strong>
                          <small>when sell price was reached</small>
                        </article>
                      </div>
                    </>
                  ) : (
                    <p className="guidance-empty">
                      {guidance.status === "insufficient-history"
                        ? `Not enough completed-hour history yet (${guidance.samples ?? 0}/3).`
                        : "Enter a current price, or wait for a usable hourly midpoint."}
                    </p>
                  )}
                </aside>
              )}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
