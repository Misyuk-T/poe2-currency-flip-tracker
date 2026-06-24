import { CandlestickSeries, HistogramSeries, LineSeries, createChart } from "/vendor/lightweight-charts.mjs?v=standalone-5.2.0";
import { convertMarketPrice, currentPriceGuidance, workingPrice } from "./price-guidance.js";

/**
 * Frontend: consumes the local backend only. No third-party CORS proxies, no
 * SAMPLE_ROWS fallback. A data failure renders as an explicit error state.
 * Hourly market charts use lightweight-charts locally vendored through the
 * backend. Users still only read cached backend data; charting never touches
 * upstream providers.
 *
 * Refresh semantics (honest, backend-controlled — A3):
 *   - users can NEVER trigger a provider fetch; the backend scheduler owns that;
 *   - the Refresh button and the automatic poll just re-read the cached snapshot;
 *   - a "warming" (503) cold start shows a soft retry, not a hard error;
 *   - a 1s ticker keeps the displayed snapshot age live;
 *   - overlapping loads are prevented by `state.loading`.
 */

const COLOR = { entry: "#9a7a37", exit: "#1d9a55", up: "#1d9a55", down: "#c2402f", grid: "#e7e0d0" };
const CHART_COLOR = {
  bg: "#0b0e11",
  panel: "#11151c",
  text: "#b7bdc6",
  muted: "#848e9c",
  grid: "rgba(132, 142, 156, 0.14)",
  border: "rgba(132, 142, 156, 0.28)",
  up: "#0ecb81",
  down: "#f6465d",
  line: "#f0b90b",
};
const mountedRadarCharts = new Map();

const state = {
  config: null,
  data: null,
  radar: null,
  catalog: [],
  catalogById: new Map(),
  activeCategory: "all",
  radarLimit: 100,
  radarPageSize: 100,
  radarDisplay: "list",
  radarSubcategory: "all",
  selectedRadarPair: null,
  radarChartCache: new Map(),
  radarChartRequest: null,
  manualPrices: loadManualPrices(),
  view: "radar",
  history: {},
  error: null,
  loading: false,
  // "" preserves the backend's horizon-aware ranking until the user picks a
  // column (riskAdjustedScore has no visible column, so it isn't a sort option).
  sortKey: "",
  sortDir: "desc",
  snapshotAtMs: null,
  pollIntervalMs: 300000,
  pollTimer: null,
  ageTimer: null,
  warmTimer: null,
};

const els = {};
for (const id of [
  "leagueLabel", "stateBadge", "refreshButton", "retryButton", "errorPanel", "errorMessage",
  "sourceLabel", "updatedLabel", "capitalInput", "goldInput", "reserveInput", "horizonInput",
  "goldModeInput", "rankInput", "gameInput", "leagueInput", "anchorInput",
  "searchInput", "minProfitInput", "actionableOnlyInput", "hideUnknownGoldInput", "hideStaleInput",
  "copyLinkButton",
  "radarViewButton", "booksViewButton", "categoryList", "radarView", "booksView", "radarSummary", "radarBody", "radarMobile",
  "radarSearchInput", "radarSortInput", "radarActiveOnlyInput", "radarResultLabel", "radarLoadMoreButton",
  "radarSubcategoryField", "radarSubcategoryInput", "radarTableModeButton", "radarChartModeButton",
  "radarListView", "radarChartView", "radarChartMarkets", "radarChartTitle", "radarChartMetrics", "radarChartCanvas", "radarKpis",
  "tableBody", "mobileList", "nonActionableWrap", "nonActionableSummary", "nonActionableBody",
  "nonActionableMobile", "profitUnit", "profit100kUnit", "modalBackdrop", "detailModal",
  "closeModal", "modalAnchor", "modalTitle", "modalSummary", "modalChart", "modalGroups", "modalWarnings",
]) {
  els[id] = document.getElementById(id);
}

const COLSPAN = 10;

// Controls that change the BACKEND query (re-read the snapshot).
const SERVER_CONTROLS = ["anchorInput", "capitalInput", "goldInput", "reserveInput", "goldModeInput", "rankInput"];
// Controls that only filter/sort CLIENT-side (no backend round trip).
const FILTER_CONTROLS = [
  "horizonInput", "searchInput", "minProfitInput", "actionableOnlyInput", "hideUnknownGoldInput", "hideStaleInput",
];
const CONTROLS = [...SERVER_CONTROLS, ...FILTER_CONTROLS]; // persisted set
const LS_KEY = "poe2flip.controls.v1";

// el id -> shareable query-param key (permalink).
const PARAM_MAP = {
  anchorInput: "anchor",
  capitalInput: "capital", goldInput: "gold", reserveInput: "reserve", horizonInput: "horizon",
  goldModeInput: "goldMode", rankInput: "rank", searchInput: "q", minProfitInput: "minProfit",
  actionableOnlyInput: "actionableOnly", hideUnknownGoldInput: "hideUnknownGold", hideStaleInput: "hideStale",
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  restoreControls();
  applyUrlParams(); // a shared permalink overrides locally-saved settings
  wireEvents();
  setView("radar");
  await loadConfig();
  await load();
  // Start timers only after the first load so the ticker has a snapshot to age
  // and the poll interval doesn't fire a wasted load during initial fetch.
  startAutoPoll();
  startAgeTicker();
}

function wireEvents() {
  // Refresh/Retry just re-read the cached snapshot — they cannot force a
  // provider fetch (the backend scheduler owns that).
  els.refreshButton.addEventListener("click", () => load());
  els.retryButton.addEventListener("click", () => load());
  els.radarViewButton?.addEventListener("click", () => setView("radar"));
  els.booksViewButton?.addEventListener("click", () => setView("books"));
  els.radarSearchInput?.addEventListener("input", () => { state.radarLimit = state.radarPageSize; renderRadar(); });
  els.radarSortInput?.addEventListener("change", () => { state.radarLimit = state.radarPageSize; renderRadar(); });
  els.radarActiveOnlyInput?.addEventListener("change", () => { state.radarLimit = state.radarPageSize; renderRadar(); });
  els.radarSubcategoryInput?.addEventListener("change", () => {
    state.radarSubcategory = els.radarSubcategoryInput.value;
    state.radarLimit = state.radarPageSize;
    renderRadar();
  });
  els.radarTableModeButton?.addEventListener("click", () => setRadarDisplay("list"));
  els.radarChartModeButton?.addEventListener("click", () => setRadarDisplay("chart"));
  els.radarLoadMoreButton?.addEventListener("click", () => {
    state.radarLimit += state.radarPageSize;
    renderRadar();
  });
  // Server-affecting controls re-read the snapshot.
  for (const k of SERVER_CONTROLS) {
    els[k]?.addEventListener("change", () => {
      persistControls();
      syncUrl();
      load();
    });
  }
  // Client-side filters only re-render the already-loaded snapshot.
  for (const k of FILTER_CONTROLS) {
    const ev = els[k]?.type === "checkbox" ? "change" : "input";
    els[k]?.addEventListener(ev, () => {
      persistControls();
      syncUrl();
      if (state.data) render();
    });
  }
  els.copyLinkButton?.addEventListener("click", copyShareLink);
  els.closeModal.addEventListener("click", closeModal);
  els.modalBackdrop.addEventListener("click", (e) => {
    if (e.target === els.modalBackdrop) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });
  document.querySelectorAll("th[data-sort]").forEach((header) => {
    header.addEventListener("click", () => {
      const key = header.dataset.sort;
      if (state.sortKey === key) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      else {
        state.sortKey = key;
        state.sortDir = key === "targetName" || key === "limitingResource" ? "asc" : "desc";
      }
      render();
    });
  });
}

async function loadConfig() {
  try {
    const [config, catalog] = await Promise.all([fetchJson("/api/config"), fetchJson("/api/catalog")]);
    state.config = config;
    state.catalog = catalog.items ?? [];
    state.catalogById = new Map(state.catalog.map((item) => [item.id, item]));
    state.pollIntervalMs = state.config.pollIntervalMs ?? state.pollIntervalMs;
    els.leagueLabel.textContent = `${state.config.league} · anchor: ${state.config.anchorCurrency}`;
    setUnits(state.config.anchorCurrency);
    renderGameLeague(state.config);
    configureFeatures(state.config);
    renderCategories();
  } catch {
    els.leagueLabel.textContent = "Config unavailable";
  }
}

function liveBooksEnabled() {
  return Boolean(state.config?.features?.liveBooks);
}

function configureFeatures(config) {
  const enabled = Boolean(config.features?.liveBooks);
  if (els.booksViewButton) els.booksViewButton.hidden = !enabled;
  document.querySelectorAll("[data-live-books-only]").forEach((el) => (el.hidden = !enabled || state.view === "radar"));
  if (!enabled && state.view === "books") setView("radar");
}

function renderCategories() {
  const preferred = ["Currency", "Fragments", "Runes", "Essences", "Expedition", "Ritual", "Breach", "Delirium", "Vaal", "Verisium", "Abyssal Bones", "Uncut Gems", "Lineage Support Gems", "Waystones"];
  const grouped = new Map();
  for (const item of state.catalog) {
    const group = grouped.get(item.category) ?? [];
    group.push(item);
    grouped.set(item.category, group);
  }
  const availableIds = state.view === "books" && liveBooksEnabled()
    ? state.data?.opportunities?.map((row) => row.targetCurrency)
    : state.radar?.rows?.map((row) => row.target);
  const available = availableIds ? new Set(availableIds) : null;
  const availableCounts = new Map();
  if (available) {
    for (const id of available) {
      const category = state.catalogById.get(id)?.category;
      if (category) availableCounts.set(category, (availableCounts.get(category) ?? 0) + 1);
    }
  }
  const categories = [...grouped.keys()].filter((category) => !available || availableCounts.has(category)).sort((a, b) => {
    const ai = preferred.indexOf(a), bi = preferred.indexOf(b);
    return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi) || a.localeCompare(b);
  });
  els.categoryList.innerHTML = categories.map((category) => {
    const items = grouped.get(category);
    const representative = items.find((item) => item.id !== state.config?.anchorCurrency) ?? items[0];
    const count = available ? availableCounts.get(category) : items.length;
    return `<button class="category-link" type="button" data-category="${escapeHtml(category)}" aria-pressed="false">
      ${iconImg(representative.id)}<span>${escapeHtml(category)}</span><small>${count}</small>
    </button>`;
  }).join("");
  if (state.activeCategory !== "all" && !categories.includes(state.activeCategory)) state.activeCategory = "all";
  document.querySelectorAll("[data-category]").forEach((button) => {
    const active = button.dataset.category === state.activeCategory;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
    button.onclick = () => setCategory(button.dataset.category);
  });
}

function setCategory(category) {
  state.activeCategory = category || "all";
  state.radarSubcategory = "all";
  state.radarLimit = state.radarPageSize;
  if (els.radarSortInput) els.radarSortInput.value = state.activeCategory === "all" ? "activity" : "price";
  document.querySelectorAll("[data-category]").forEach((button) => {
    const active = button.dataset.category === state.activeCategory;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  renderSubcategories();
  if (state.radar) renderRadar();
  if (state.data) render();
}

function renderSubcategories() {
  if (!els.radarSubcategoryField || !els.radarSubcategoryInput) return;
  if (state.activeCategory === "all") {
    els.radarSubcategoryField.hidden = true;
    state.radarSubcategory = "all";
    return;
  }
  const rows = (state.radar?.rows ?? []).filter((row) => categoryMatches(row.target, row.category));
  const counts = new Map();
  for (const row of rows) {
    const group = row.subcategory ?? state.catalogById.get(row.target)?.subcategory ?? row.category;
    counts.set(group, (counts.get(group) ?? 0) + 1);
  }
  const groups = [...counts].sort((a, b) => {
    const ar = rows.find((row) => (row.subcategory ?? row.category) === a[0]);
    const br = rows.find((row) => (row.subcategory ?? row.category) === b[0]);
    return (ar?.catalogOrder ?? 999999) - (br?.catalogOrder ?? 999999) || a[0].localeCompare(b[0]);
  });
  els.radarSubcategoryField.hidden = groups.length < 2;
  els.radarSubcategoryInput.innerHTML = `<option value="all">All groups (${rows.length})</option>${groups.map(([name, count]) => `<option value="${escapeHtml(name)}">${escapeHtml(name)} (${count})</option>`).join("")}`;
  els.radarSubcategoryInput.value = groups.some(([name]) => name === state.radarSubcategory) ? state.radarSubcategory : "all";
}

function setRadarDisplay(mode) {
  state.radarDisplay = mode === "chart" ? "chart" : "list";
  els.radarTableModeButton?.setAttribute("aria-pressed", String(state.radarDisplay === "list"));
  els.radarChartModeButton?.setAttribute("aria-pressed", String(state.radarDisplay === "chart"));
  renderRadar();
}

function categoryMatches(targetId, explicitCategory = null) {
  return state.activeCategory === "all" || (explicitCategory ?? state.catalogById.get(targetId)?.category) === state.activeCategory;
}

// Game + league selectors come entirely from the backend (no league hardcoded
// here). PoE1 and not-yet-polled leagues render as disabled.
function renderGameLeague(config) {
  const games = config.games ?? [];
  els.gameInput.innerHTML = games
    .map(
      (g) =>
        `<option value="${escapeHtml(g.id)}" ${g.id === config.game ? "selected" : ""} ${
          g.enabled ? "" : "disabled"
        }>${escapeHtml(g.label)}${g.enabled ? "" : ` — ${escapeHtml(g.reason ?? "unavailable")}`}</option>`,
    )
    .join("");
  const active = games.find((g) => g.id === config.game) ?? games[0];
  const leagues = active?.leagues ?? [];
  els.leagueInput.innerHTML = leagues
    .map(
      (l) =>
        `<option value="${escapeHtml(l.id)}" ${l.id === config.league ? "selected" : ""} ${
          l.enabled ? "" : "disabled"
        }>${escapeHtml(l.label)}${l.enabled ? "" : " — not polled"}</option>`,
    )
    .join("");

  // Anchor selector (dynamically populated -> reconcile saved/permalink choice).
  const anchors = config.anchors ?? [config.anchorCurrency];
  const chosen = preferredAnchor(config);
  els.anchorInput.innerHTML = anchors
    .map((a) => `<option value="${escapeHtml(a)}" ${a === chosen ? "selected" : ""}>${escapeHtml(a)}</option>`)
    .join("");
  els.anchorInput.value = chosen;
}

// The anchor select is built after config loads, so restoreControls()/URL params
// can't reach it directly — resolve the desired anchor here (URL > saved > default).
function preferredAnchor(config) {
  const anchors = config.anchors ?? [config.anchorCurrency];
  const url = new URLSearchParams(location.search).get("anchor");
  if (url && anchors.includes(url)) return url;
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
    if (saved.anchorInput && anchors.includes(saved.anchorInput)) return saved.anchorInput;
  } catch {
    /* ignore */
  }
  return config.anchorCurrency;
}

// Local icon with graceful fallback to the neutral glyph (icons are downloaded
// on demand by scripts/build-catalog.mjs; missing ones 404 -> fallback).
function iconImg(id) {
  return `<img class="cur-icon" src="/icons/${encodeURIComponent(id)}.png" alt="" loading="lazy" onerror="this.onerror=null;this.src='/icons/_fallback.svg'">`;
}

function marketPrice(row) {
  const price = row?.displayPrice;
  if (!price?.unit || !Number.isFinite(price.value)) return "—";
  const label = price.unit === "divine" ? "Divine Orb" : price.unit === "exalted" ? "Exalted Orb" : price.unit;
  return `<span class="market-price"><span>${num(price.value)}</span><img class="price-unit-icon" src="/icons/${encodeURIComponent(price.unit)}.png" alt="${escapeHtml(label)}" title="${escapeHtml(label)}" onerror="this.onerror=null;this.src='/icons/_fallback.svg'"></span>`;
}

function startAutoPoll() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  // Cache-friendly re-read aligned with the backend poll interval.
  state.pollTimer = setInterval(() => load(), state.pollIntervalMs);
}

function startAgeTicker() {
  if (state.ageTimer) clearInterval(state.ageTimer);
  state.ageTimer = setInterval(updateAgeLabel, 1000);
}

function setUnits(anchor) {
  const u = anchor ? `(${anchor})` : "";
  if (els.profitUnit) els.profitUnit.textContent = u;
  if (els.profit100kUnit) els.profit100kUnit.textContent = u;
}

async function load() {
  if (state.loading) return;
  state.loading = true;
  clearTimeout(state.warmTimer);
  els.refreshButton.disabled = true;
  els.refreshButton.textContent = "Loading…";
  setBadge("loading", "Loading");

  // No hardcoded anchor fallback: if config failed to load, omit it and let the
  // backend apply its own default anchor.
  const anchor = els.anchorInput?.value || state.config?.anchorCurrency || "";
  const params = new URLSearchParams({
    capital: numVal(els.capitalInput, 0),
    gold: numVal(els.goldInput, 0),
    reserve: numVal(els.reserveInput, 0),
    horizon: numVal(els.horizonInput, 3),
    goldMode: els.goldModeInput?.value ?? "strict",
    rank: els.rankInput?.value ?? "default",
  });
  if (anchor) params.set("anchor", anchor);

  const radarPromise = fetchJson(`/api/radar${anchor ? `?anchor=${encodeURIComponent(anchor)}` : ""}`)
    .then((radar) => ({ radar }), (error) => ({ error }));

  if (liveBooksEnabled()) {
    const booksPromise = fetchJson(`/api/opportunities?${params.toString()}`);
    const historyPromise = fetchJson(`/api/history${anchor ? `?anchor=${encodeURIComponent(anchor)}` : ""}`).catch(() => ({ series: {} }));
    try {
      const [data, hist] = await Promise.all([booksPromise, historyPromise]);
      state.data = data;
      state.history = hist.series ?? {};
      state.snapshotAtMs = Date.parse(data.snapshotAt);
      state.error = null;
      els.errorPanel.hidden = true;
      render();
    } catch (err) {
      if (err.payload?.state === "warming") {
        renderWarming();
        state.warmTimer = setTimeout(() => load(), 3000); // soft retry until the first snapshot lands
      } else {
        state.data = null;
        state.snapshotAtMs = null;
        state.error = err.payload?.error ?? { code: "network", message: err.message };
        renderError();
      }
    }
  } else {
    state.data = null;
    state.history = {};
    state.error = null;
    state.snapshotAtMs = null;
    els.errorPanel.hidden = true;
  }
  const radarResult = await radarPromise;
  if (!radarResult.error) {
    state.radar = radarResult.radar;
    renderCategories();
    renderRadar();
  } else {
    state.radar = null;
    els.radarSummary.textContent = "Hourly market cache is unavailable. No data has been fabricated.";
    els.radarBody.innerHTML = '<tr><td colspan="11" class="empty-state">Market Radar could not be loaded.</td></tr>';
    els.radarMobile.innerHTML = "";
  }
  state.loading = false;
  els.refreshButton.disabled = false;
  els.refreshButton.textContent = "Refresh";
}

function renderWarming() {
  state.data = null;
  state.snapshotAtMs = null;
  setBadge("loading", "Warming up");
  els.sourceLabel.textContent = "Source: warming up…";
  els.updatedLabel.textContent = "Snapshot: preparing";
  els.errorPanel.hidden = true;
  els.tableBody.innerHTML = `<tr><td colspan="${COLSPAN}" class="empty-state">Backend is preparing the first snapshot — retrying…</td></tr>`;
  els.mobileList.innerHTML = "";
  els.nonActionableWrap.hidden = true;
}

function setView(view) {
  if (view === "books" && !liveBooksEnabled()) view = "radar";
  const radar = view === "radar";
  state.view = view;
  els.radarView.hidden = !radar;
  els.booksView.hidden = radar;
  els.radarViewButton.classList.toggle("active", radar);
  els.booksViewButton.hidden = !liveBooksEnabled();
  els.booksViewButton.classList.toggle("active", !radar && liveBooksEnabled());
  els.radarViewButton.setAttribute("aria-pressed", String(radar));
  els.booksViewButton.setAttribute("aria-pressed", String(!radar && liveBooksEnabled()));
  document.querySelectorAll("[data-live-books-only]").forEach((el) => (el.hidden = radar || !liveBooksEnabled()));
  renderCategories();
  if (radar && state.radar) renderRadar();
  if (!radar && state.data) render();
}

function renderRadar() {
  const d = state.radar;
  if (!d) return;
  const allRows = d.rows ?? [];
  const categoryRows = allRows.filter((row) => categoryMatches(row.target, row.category));
  const trackedRows = categoryRows.filter((row) => row.status !== "no-trades-this-hour");
  const mode = d.source?.sourceMode === "official" ? "Official GGG" : d.source?.sourceMode === "fixture" ? "Fixture" : "Waiting for OAuth";
  const latest = d.source?.latestCompletedHour;
  if (!state.data) {
    setBadge(mode === "Official GGG" ? "live" : mode === "Fixture" ? "fixture" : "degraded", mode === "Official GGG" ? "Hourly" : mode);
    els.sourceLabel.textContent = `Hourly source: ${mode}`;
    els.updatedLabel.textContent = latest ? `Completed hour: ${formatDateTime(latest)}` : "Completed hour: waiting";
  }
  const categoryText = state.activeCategory === "all"
    ? `${trackedRows.length} active · ${categoryRows.length} catalog items`
    : `${state.activeCategory} · ${trackedRows.length} active of ${categoryRows.length}`;
  els.radarSummary.textContent = `${mode} · ${categoryText} · completed hourly data${latest ? ` through ${formatDateTime(latest)}` : " not available yet"}. Scores describe history; they do not predict a sale.`;
  renderRadarKpis(trackedRows);
  const query = (els.radarSearchInput?.value ?? "").trim().toLocaleLowerCase();
  renderSubcategories();
  let rows = categoryRows.filter((row) => state.radarSubcategory === "all" || row.subcategory === state.radarSubcategory);
  rows = rows.filter((row) => !query || `${row.targetName} ${row.target}`.toLocaleLowerCase().includes(query));
  if (els.radarActiveOnlyInput?.checked) rows = rows.filter((row) => row.status !== "no-trades-this-hour");
  rows = sortRadarRows(rows, els.radarSortInput?.value ?? "activity");
  const visibleRows = rows.slice(0, state.radarLimit);
  if (els.radarResultLabel) els.radarResultLabel.textContent = `Showing ${visibleRows.length} of ${rows.length}`;
  if (els.radarLoadMoreButton) {
    els.radarLoadMoreButton.hidden = visibleRows.length >= rows.length;
    els.radarLoadMoreButton.textContent = `Load more markets (${rows.length - visibleRows.length} remaining)`;
  }
  if (els.radarListView) els.radarListView.hidden = state.radarDisplay !== "list";
  if (els.radarChartView) els.radarChartView.hidden = state.radarDisplay !== "chart";
  if (!rows.length) {
    els.radarBody.innerHTML = '<tr><td colspan="7" class="empty-state">No markets match these filters.</td></tr>';
    els.radarMobile.innerHTML = "";
    return;
  }
  els.radarBody.innerHTML = visibleRows.map(renderRadarRow).join("");
  els.radarMobile.innerHTML = visibleRows.map(renderRadarCard).join("");
  document.querySelectorAll("[data-radar-pair]").forEach((el) => {
    el.addEventListener("click", () => openRadarDetail(el.dataset.radarPair));
  });
  document.querySelectorAll("[data-radar-open]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openRadarDetail(button.dataset.radarOpen);
    });
  });
  renderRadarChartView(rows);
}

function renderRadarKpis(rows) {
  if (!els.radarKpis) return;
  const active = rows.filter((row) => row.status !== "no-trades-this-hour");
  if (!active.length) {
    els.radarKpis.innerHTML = `<article class="radar-kpi"><p>Market Pulse</p><strong>—</strong><span>No active hourly markets</span></article>
      <article class="radar-kpi"><p>Best Liquidity</p><strong>—</strong><span>No completed-hour volume</span></article>
      <article class="radar-kpi"><p>Volume Spikes</p><strong>—</strong><span>No acceleration signal</span></article>
      <article class="radar-kpi"><p>Falling Prices</p><strong>—</strong><span>No 24h movement yet</span></article>`;
    return;
  }
  const pulse = [...active].sort((a, b) => (b.activityScore ?? -Infinity) - (a.activityScore ?? -Infinity))[0];
  const liquidity = [...active].sort((a, b) => (b.volume ?? -Infinity) - (a.volume ?? -Infinity))[0];
  const volumeSpikes = active.filter((row) => Number.isFinite(row.volumeAcceleration) && row.volumeAcceleration >= 1.25);
  const falling = active.filter((row) => Number.isFinite(row.movement?.h24) && row.movement.h24 < 0);
  els.radarKpis.innerHTML = [
    radarKpiCard("Market Pulse", num(pulse.activityScore), "/100 market activity score", pctSigned(pulse.movement?.h1), "vs last hour", pulse.sparkline24h),
    radarKpiCard("Best Liquidity", whole(liquidity.volume), liquidity.targetName, "24h volume", "", liquidity.sparkline24h),
    radarKpiCard("Volume Spikes", whole(volumeSpikes.length), "items with unusual volume increase", volumeSpikes[0] ? ratioChange(volumeSpikes[0].volumeAcceleration) : "—", "top spike", volumeSpikes[0]?.sparkline24h),
    radarKpiCard("Falling Prices", whole(falling.length), "items with falling prices", falling[0] ? pctSigned(falling[0].movement?.h24) : "—", "worst 24h", falling[0]?.sparkline24h),
  ].join("");
}

function radarKpiCard(title, value, subtitle, delta, deltaLabel, sparklinePoints) {
  const values = (sparklinePoints ?? []).map((p) => Array.isArray(p) ? p[1] : p).filter(Number.isFinite);
  const hasDelta = delta && delta !== "—";
  const spark = values.length >= 2 ? radarSparkline(values, { w: 116, h: 34 }) : "";
  return `<article class="radar-kpi">
    <p>${escapeHtml(title)}</p>
    <div class="radar-kpi-main"><strong>${escapeHtml(String(value))}</strong>${spark}</div>
    <span>${escapeHtml(subtitle)}</span>
    ${hasDelta ? `<small class="${profitClass(parsePercentish(delta))}">${escapeHtml(delta)}${deltaLabel ? ` · ${escapeHtml(deltaLabel)}` : ""}</small>` : ""}
  </article>`;
}

function sortRadarRows(rows, key) {
  const missingLast = (value, fallback) => Number.isFinite(value) ? value : fallback;
  return [...rows].sort((a, b) => {
    // Regardless of sort, markets without a completed-hour observation stay
    // below markets that have an actual signal.
    const aMissing = a.status === "no-trades-this-hour";
    const bMissing = b.status === "no-trades-this-hour";
    if (aMissing !== bMissing) return aMissing ? 1 : -1;
    if (key === "progression") {
      const group = (a.catalogOrder ?? 999999) - (b.catalogOrder ?? 999999);
      return group || missingLast(b.reference, -Infinity) - missingLast(a.reference, -Infinity) || a.targetName.localeCompare(b.targetName);
    }
    if (key === "price") return missingLast(b.reference, -Infinity) - missingLast(a.reference, -Infinity) || a.targetName.localeCompare(b.targetName);
    if (key === "gainers") return missingLast(b.movement?.h24, -Infinity) - missingLast(a.movement?.h24, -Infinity);
    if (key === "losers") return missingLast(a.movement?.h24, Infinity) - missingLast(b.movement?.h24, Infinity);
    if (key === "volume") return missingLast(b.volume, -Infinity) - missingLast(a.volume, -Infinity);
    if (key === "arbitrage") return missingLast(b.arbitrageScore, -Infinity) - missingLast(a.arbitrageScore, -Infinity);
    return missingLast(b.activityScore, -Infinity) - missingLast(a.activityScore, -Infinity);
  });
}

function renderRadarChartView(rows) {
  if (!els.radarChartMarkets || state.radarDisplay !== "chart") return;
  const markets = rows.filter((row) => row.pairId).slice(0, 30);
  if (!markets.length) {
    els.radarChartMarkets.innerHTML = '<p class="empty-state">No chartable markets.</p>';
    setChartHtml(els.radarChartCanvas, '<p class="spark-fallback">No hourly history for these filters.</p>');
    return;
  }
  let selected = markets.find((row) => row.pairId === state.selectedRadarPair) ?? markets[0];
  state.selectedRadarPair = selected.pairId;
  els.radarChartMarkets.innerHTML = markets.map((row) => `<button class="radar-chart-market ${row.pairId === selected.pairId ? "active" : ""}" type="button" data-chart-pair="${escapeHtml(row.pairId)}">
    ${iconImg(row.target)}<span><strong>${escapeHtml(row.targetName)}</strong><small>${marketPrice(row)} · ${pctSigned(row.movement?.h24)}</small></span>
  </button>`).join("");
  document.querySelectorAll("[data-chart-pair]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedRadarPair = button.dataset.chartPair;
      renderRadarChartView(rows);
    });
  });
  els.radarChartTitle.innerHTML = `${iconImg(selected.target)} ${escapeHtml(selected.targetName)} / ${escapeHtml(selected.anchor)}`;
  els.radarChartMetrics.innerHTML = `<span>${marketPrice(selected)}</span><strong class="${profitClass(selected.movement?.h24)}">${pctSigned(selected.movement?.h24)} 24h</strong><span>Vol ${whole(selected.volume)}</span>`;
  loadRadarChart(selected);
}

async function loadRadarChart(row) {
  const key = `${row.anchor}:${row.pairId}`;
  const cached = state.radarChartCache.get(key);
  if (cached) {
    const wp = workingPriceForRow(row);
    setChartHtml(els.radarChartCanvas, renderRadarChart(cached, { chartId: "radar-main-chart", height: 420, displayUnit: wp.unit, anchor: row.anchor, divineInExalted: state.radar?.units?.divineInExalted }));
    return;
  }
  const request = key;
  state.radarChartRequest = request;
  setChartHtml(els.radarChartCanvas, '<p class="spark-fallback">Loading hourly chart…</p>');
  try {
    const data = await fetchJson(`/api/radar/history?pair=${encodeURIComponent(row.pairId)}&anchor=${encodeURIComponent(row.anchor)}`);
    state.radarChartCache.set(key, data.series ?? []);
    if (state.radarChartRequest === request && state.selectedRadarPair === row.pairId) {
      const wp = workingPriceForRow(row);
      setChartHtml(els.radarChartCanvas, renderRadarChart(data.series ?? [], { chartId: "radar-main-chart", height: 420, displayUnit: wp.unit, anchor: row.anchor, divineInExalted: state.radar?.units?.divineInExalted }));
    }
  } catch {
    if (state.radarChartRequest === request) setChartHtml(els.radarChartCanvas, '<p class="spark-fallback">Hourly chart could not be loaded.</p>');
  }
}

function renderRadarRow(r) {
  const noTrades = r.status === "no-trades-this-hour";
  const pairAttr = r.pairId ? ` data-radar-pair="${escapeHtml(r.pairId)}"` : "";
  const signal = radarSignalLabel(r);
  return `<tr${pairAttr} class="${noTrades ? "no-trades-row" : ""}">
    <td><div class="market-item-cell">${iconImg(r.target)}<div class="currency-name"><strong>${escapeHtml(r.targetName)}</strong><span class="category" title="${escapeHtml(r.target)}">${escapeHtml(r.subcategory ?? r.category ?? "Market")}</span></div></div></td>
    <td><div class="signal-cell">${signalScore(r.activityScore)}<div><strong>${escapeHtml(signal.title)}</strong><span>${escapeHtml(signal.body)}</span></div></div></td>
    <td class="right num">${marketPrice(r)}<small class="cell-subtext">in ${escapeHtml(r.anchor)}</small></td>
    <td><div class="trend-cell">${radarSparkline(r.sparkline24h, { w: 104, h: 34 })}<strong class="${profitClass(r.movement?.h24)}">${pctSigned(r.movement?.h24)}</strong></div></td>
    <td class="right num"><strong>${whole(r.volume)}</strong><small class="cell-subtext ${liquidityClass(r.volume)}">${escapeHtml(liquidityLabel(r.volume))}</small></td>
    <td><div class="risk-cell">${riskScore(r.arbitrageScore)}<span>${escapeHtml(riskLabel(r.arbitrageScore))}</span></div></td>
    <td class="right action-cell">${radarAnalyzeAction(r)}<button class="row-menu" type="button" aria-label="More actions" onclick="event.stopPropagation()">⋮</button></td>
  </tr>`;
}

function renderRadarCard(r) {
  const pairAttr = r.pairId ? ` data-radar-pair="${escapeHtml(r.pairId)}"` : "";
  const noTrades = r.status === "no-trades-this-hour";
  return `<article class="mobile-card ${r.status === "no-trades-this-hour" ? "no-trades-row" : ""}"${pairAttr}>
    <div class="mobile-card-top"><span class="currency-cell">${iconImg(r.target)}<strong>${escapeHtml(r.targetName)}</strong></span>${noTrades ? '<span class="no-trades-label">No hourly trades</span>' : score(r.activityScore, "activity")}</div>
    ${radarSparkline(r.sparkline24h, { w: 270, h: 44 })}
    ${noTrades ? "" : `<p class="radar-card-reason">${escapeHtml(radarSignalReason(r))}</p>`}
    <div class="mobile-stats"><div class="mobile-stat"><span>Now</span><strong class="num">${marketPrice(r)}</strong></div>
    <div class="mobile-stat"><span>24h move</span><strong class="num ${profitClass(r.movement?.h24)}">${pctSigned(r.movement?.h24)}</strong></div>
    <div class="mobile-stat"><span>Volume</span><strong class="num">${whole(r.volume)}</strong></div>
    <div class="mobile-stat"><span>Arbitrage</span><strong class="num">${num(r.arbitrageScore)}</strong></div></div>
    ${radarAnalyzeAction(r)}
  </article>`;
}

function radarSignalReason(r) {
  if (r.stale) return "Stale hourly history";
  const move = r.movement?.h24;
  const volumeChange = Number.isFinite(r.volumeAcceleration) ? r.volumeAcceleration - 1 : null;
  if (Number.isFinite(move) && Math.abs(move) >= 0.1) {
    const direction = move > 0 ? "up" : "down";
    const volume = Number.isFinite(volumeChange) && volumeChange >= 0.15 ? ` · volume ${pctSigned(volumeChange)}` : "";
    return `24h ${direction} ${pctSigned(Math.abs(move))}${volume}`;
  }
  if (r.arbitrageScore >= 70) return "Stable + liquid profile";
  if (r.activityScore >= 60) return "High hourly activity";
  if (Number.isFinite(volumeChange) && volumeChange >= 0.25) return `Volume accelerating ${pctSigned(volumeChange)}`;
  return "Hourly market history";
}

function radarSignalLabel(r) {
  if (r.status === "no-trades-this-hour") return { title: "Archived", body: "No trades this hour" };
  if (r.stale) return { title: "Stale", body: "Stale signal" };
  if (r.activityScore >= 70) return { title: "Strong", body: "High movement" };
  if (r.activityScore >= 40) return { title: "Good", body: "Watchable setup" };
  if (r.activityScore >= 20) return { title: "Average", body: "Low urgency" };
  return { title: "Weak", body: "Quiet market" };
}

function signalScore(value) {
  if (!Number.isFinite(value)) return '<span class="signal-score muted">—</span>';
  const level = value >= 70 ? "strong" : value >= 40 ? "good" : value >= 20 ? "average" : "weak";
  return `<span class="signal-score" data-level="${level}">${num(value)}</span>`;
}

function riskScore(value) {
  if (!Number.isFinite(value)) return '<span class="risk-score muted">—</span>';
  const level = value >= 70 ? "low" : value >= 45 ? "medium" : "high";
  return `<span class="risk-score" data-risk="${level}">${num(value)}</span>`;
}

function riskLabel(value) {
  if (!Number.isFinite(value)) return "Unknown Risk";
  if (value >= 70) return "Low Risk";
  if (value >= 45) return "Medium Risk";
  return "High Risk";
}

function liquidityLabel(value) {
  if (!Number.isFinite(value)) return "Unknown";
  if (value >= 20_000) return "Very High";
  if (value >= 7_500) return "High";
  if (value >= 2_000) return "Medium";
  return "Thin";
}

function liquidityClass(value) {
  if (!Number.isFinite(value)) return "";
  if (value >= 7_500) return "liquidity-high";
  if (value >= 2_000) return "liquidity-mid";
  return "liquidity-low";
}

function parsePercentish(value) {
  if (typeof value !== "string") return null;
  const parsed = Number(value.replace(/[+,%\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function radarAnalyzeAction(r) {
  return r.pairId
    ? `<button class="radar-analyze" type="button" data-radar-open="${escapeHtml(r.pairId)}">Plan Trade</button>`
    : '<span class="radar-hourly-only" title="No completed hourly market data for this item yet">Hourly only</span>';
}

function analyzeFlip(targetId) {
  const opportunity = state.data?.opportunities?.find((o) => o.targetCurrency === targetId);
  if (!opportunity) return;
  state.activeCategory = "all";
  els.searchInput.value = opportunity.targetName;
  persistControls();
  syncUrl();
  setView("books");
  openDetail(targetId);
}

async function openRadarDetail(pairId) {
  const r = state.radar?.rows?.find((x) => x.pairId === pairId);
  if (!r) return;
  els.modalAnchor.textContent = `${r.targetName} priced in ${r.anchor}`;
  els.modalTitle.innerHTML = `${iconImg(r.target)} ${escapeHtml(r.targetName)} trade plan`;
  els.modalSummary.textContent = "Hourly market history plus your current observed price. No live trade-site book is used for this MVP.";
  els.modalChart.hidden = false;
  renderRadarGuidance(r, []);
  setChartHtml(els.modalChart, '<p class="spark-fallback">Loading hourly history…</p>');
  els.modalWarnings.innerHTML = r.stale ? '<p class="warn-line">Hourly digest is stale.</p>' : "";
  els.modalBackdrop.hidden = false;
  els.detailModal.showModal();
  try {
    const d = await fetchJson(`/api/radar/history?pair=${encodeURIComponent(pairId)}&anchor=${encodeURIComponent(r.anchor)}`);
    const series = d.series ?? [];
    renderRadarGuidance(r, series);
    const wp = workingPriceForRow(r);
    setChartHtml(els.modalChart, renderRadarChart(series, { chartId: "radar-modal-chart", height: 360, displayUnit: wp.unit, anchor: r.anchor, divineInExalted: state.radar?.units?.divineInExalted }));
  } catch {
    setChartHtml(els.modalChart, '<p class="spark-fallback">Hourly history could not be loaded.</p>');
  }
}

function renderRadarGuidance(row, series) {
  const key = manualPriceKey(row);
  const saved = state.manualPrices[key];
  const wp = workingPriceForRow(row);
  const unit = wp.unit ?? row.anchor;
  const horizonHours = Number(els.horizonInput?.value) || 3;
  const guidance = currentPriceGuidance(series, wp.anchorValue, { horizonHours });
  const entry = guidance.status === "ok" ? convertMarketPrice(guidance.entry, row.anchor, unit, state.radar?.units?.divineInExalted) : null;
  const exit = guidance.status === "ok" ? convertMarketPrice(guidance.exit, row.anchor, unit, state.radar?.units?.divineInExalted) : null;
  const workingPriceBlock = wp.status === "ok"
    ? `<div class="working-price ${wp.source === "manual" ? "manual" : "hourly"}">
        <span>Working price</span>
        <strong>${guidanceValue(wp.value, unit)}</strong>
        <small>${escapeHtml(wp.sourceLabel)}${wp.ageMs == null ? "" : ` · ${formatAge(wp.ageMs)} ago`}</small>
      </div>`
    : `<div class="working-price missing"><span>Working price</span><strong>—</strong><small>${escapeHtml(wp.sourceLabel)}</small></div>`;
  const verdict = tradeVerdict(row, guidance);
  const output = wp.status !== "ok"
    ? '<p class="guidance-empty">Enter the price available to you right now, or wait for the next hourly market digest.</p>'
    : guidance.status === "insufficient-history"
      ? `<p class="guidance-empty">Not enough completed-hour ranges (${guidance.samples ?? 0}/3) for a ${horizonHours}h plan.</p>`
      : guidance.status !== "ok" || entry == null || exit == null
        ? '<p class="guidance-empty">This price cannot be converted with the current market snapshot.</p>'
        : `<div class="guidance-results">
            <div><span>Buy / enter at or below</span><strong>${guidanceValue(entry, unit)}</strong><small>${pctSigned(guidance.entryDiscount)} vs working price</small></div>
            <div><span>Sell / exit at or above</span><strong>${guidanceValue(exit, unit)}</strong><small>${pctSigned(guidance.exitPremium)} vs working price</small></div>
            <div><span>Historical hit rate</span><strong>${pct(guidance.hitRate)}</strong><small>${guidance.horizonSamples || guidance.samples} rolling ${horizonHours}h windows</small></div>
            <div><span>Median time to hit</span><strong>${hours(guidance.medianTimeToHitHours)}</strong><small>when target was reached</small></div>
          </div>`;

  els.modalGroups.innerHTML = `<section class="price-guidance">
    <div class="guidance-heading"><div><h3>${escapeHtml(verdict.title)}</h3><p>${escapeHtml(verdict.body)}</p></div>${wp.source === "manual" ? '<button class="guidance-clear" type="button" data-clear-current-price>Clear</button>' : ""}</div>
    ${workingPriceBlock}
    <div class="guidance-input-row">
      <label for="currentMarketPrice">Current price</label>
      <input id="currentMarketPrice" data-current-market-price type="number" min="0" step="any" inputmode="decimal" value="${wp.source === "manual" ? wp.value : ""}" placeholder="e.g. 240">
      <select data-current-price-unit aria-label="Current price currency">
        <option value="exalted" ${unit === "exalted" ? "selected" : ""}>Exalted Orb</option>
        <option value="divine" ${unit === "divine" ? "selected" : ""}>Divine Orb</option>
      </select>
      <button class="button guidance-apply" type="button" data-apply-current-price>Apply</button>
    </div>
    ${output}
    <p class="guidance-note">Historical hit rate describes past hourly windows. It is not a guaranteed fill or a prediction.</p>
  </section><details class="modal-advanced"><summary>Technical hourly signal</summary>${group("Current signal", [["Activity", signalLabel(row)], ["Activity score", num(row.activityScore)], ["Arbitrage score", num(row.arbitrageScore)], ["24h movement", pctSigned(row.movement?.h24)], ["24h volatility", pct(row.volatility24h)], ["Recent hourly volume", whole(row.volume)], ["Coverage", pct(row.coverage24h)], ["Median adverse move", pct(guidance.medianAdverseMove)]])}</details>`;

  const input = els.modalGroups.querySelector("[data-current-market-price]");
  const select = els.modalGroups.querySelector("[data-current-price-unit]");
  input?.addEventListener("change", () => saveManualPrice(row, input.value, select.value, series));
  select?.addEventListener("change", () => {
    const converted = convertMarketPrice(Number(input.value), unit, select.value, state.radar?.units?.divineInExalted);
    if (converted != null) input.value = editableNumber(converted);
    saveManualPrice(row, input.value, select.value, series);
  });
  els.modalGroups.querySelector("[data-apply-current-price]")?.addEventListener("click", () => saveManualPrice(row, input.value, select.value, series));
  input?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") saveManualPrice(row, input.value, select.value, series);
  });
  els.modalGroups.querySelector("[data-clear-current-price]")?.addEventListener("click", () => {
    delete state.manualPrices[key];
    persistManualPrices();
    renderRadarGuidance(row, series);
  });
}

function saveManualPrice(row, rawValue, unit, series) {
  const value = Number(rawValue);
  const key = manualPriceKey(row);
  if (Number.isFinite(value) && value > 0 && ["exalted", "divine"].includes(unit)) state.manualPrices[key] = { value, unit, updatedAt: Date.now() };
  else delete state.manualPrices[key];
  persistManualPrices();
  renderRadarGuidance(row, series);
}

function workingPriceForRow(row) {
  return workingPrice(row, state.manualPrices[manualPriceKey(row)], { divineInExalted: state.radar?.units?.divineInExalted });
}

function tradeVerdict(row, guidance) {
  const horizon = Number(els.horizonInput?.value) || 3;
  if (row.stale) return { title: "Stale hourly model", body: "The latest completed-hour data is old, so treat this market as watch-only." };
  if (guidance.status !== "ok") return { title: "Needs more history", body: `Not enough completed-hour data for a ${horizon}h recommendation yet.` };
  if (Number.isFinite(guidance.hitRate) && guidance.hitRate >= 0.6) return { title: `Good ${horizon}h candidate`, body: "Past hourly windows often reached the suggested exit, but you still need to verify the real in-game price." };
  if (Number.isFinite(guidance.hitRate) && guidance.hitRate < 0.35) return { title: `Weak ${horizon}h setup`, body: "Past windows rarely reached the suggested exit in this horizon." };
  if (row.arbitrageScore >= 70) return { title: `Stable ${horizon}h watch`, body: "The market is relatively stable and liquid; use a conservative entry." };
  return { title: `Plan a ${horizon}h trade`, body: "Use the working price and recent hourly ranges to set a conservative entry and exit." };
}

function signalLabel(row) {
  if (row.stale) return "Stale";
  if (row.arbitrageScore >= 70) return "Stable + liquid";
  if (row.activityScore >= 60) return "Fast-moving";
  if (row.volume == null) return "Thin history";
  return "Normal";
}

function guidanceValue(value, unit) {
  const label = unit === "divine" ? "Divine Orb" : "Exalted Orb";
  return `<span class="market-price"><span>${num(value)}</span><img class="price-unit-icon" src="/icons/${unit}.png" alt="${label}" title="${label}"></span>`;
}

function editableNumber(value) {
  return Number(value.toPrecision(8)).toString();
}

function manualPriceKey(row) {
  return `${state.config?.game ?? "poe2"}|${state.config?.league ?? "default"}|${row.target}`;
}

function loadManualPrices() {
  try {
    const parsed = JSON.parse(localStorage.getItem("poe2flip.manual-prices.v1") || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function persistManualPrices() {
  localStorage.setItem("poe2flip.manual-prices.v1", JSON.stringify(state.manualPrices));
}

function render() {
  const d = state.data;
  if (!d) return;
  setUnits(d.anchorCurrency);

  setBadge(d.degraded ? "degraded" : d.state, d.degraded ? "Degraded" : d.state === "live" ? "Live" : "Fixture");
  els.sourceLabel.textContent = `Source: ${d.providerLabel}`;
  els.leagueLabel.textContent = `${d.league} · anchor: ${d.anchorCurrency}`;
  updateAgeLabel();

  const filtered = sortRows(d.opportunities.filter((o) => categoryMatches(o.targetCurrency)).filter(passesFilters));
  const filtersActive = anyFilterActive();
  const actionable = filtered.filter((o) => o.actionable);
  const nonActionable = els.actionableOnlyInput.checked ? [] : filtered.filter((o) => !o.actionable);

  if (!actionable.length) {
    const msg = filtersActive
      ? "No opportunities match your filters."
      : "No actionable opportunities — see non-actionable below.";
    els.tableBody.innerHTML = `<tr><td colspan="${COLSPAN}" class="empty-state">${msg}</td></tr>`;
    els.mobileList.innerHTML = `<div class="empty-state">${msg}</div>`;
  } else {
    els.tableBody.innerHTML = actionable.map(renderRow).join("");
    els.mobileList.innerHTML = actionable.map(renderCard).join("");
  }

  renderNonActionable(nonActionable);
  bindRowClicks();
  updateSortHeaders();
}

function renderNonActionable(rows) {
  if (!rows.length) {
    els.nonActionableWrap.hidden = true;
    return;
  }
  els.nonActionableWrap.hidden = false;
  els.nonActionableSummary.textContent = `Non-actionable opportunities (${rows.length})`;
  els.nonActionableBody.innerHTML = rows
    .map(
      (o) => `
      <tr data-target="${escapeHtml(o.targetCurrency)}">
        <td><div class="currency-cell">${iconImg(o.targetCurrency)}<div class="currency-name"><strong>${escapeHtml(
          o.targetName,
        )}</strong><span class="category">${escapeHtml(o.marketFreshness?.tier ?? "manual")} · updated ${formatAge(
          o.marketFreshness?.ageMs,
        )} ago</span></div></div></td>
        <td class="right num">${num(o.entryVWAP)}</td>
        <td class="right num">${num(o.exitVWAP)}</td>
        <td class="right num ${profitClass(o.grossProfit)}">${signed(o.grossProfit)}</td>
        <td>${reasonPill(o)}</td>
      </tr>`,
    )
    .join("");
  els.nonActionableMobile.innerHTML = rows
    .map(
      (o) => `
      <article class="mobile-card" data-target="${escapeHtml(o.targetCurrency)}">
        <div class="mobile-card-top"><strong>${escapeHtml(o.targetName)}</strong>${reasonPill(o)}</div>
        <div class="mobile-stats">
          <div class="mobile-stat"><span>Entry</span><span class="num">${num(o.entryVWAP)}</span></div>
          <div class="mobile-stat"><span>Exit</span><span class="num">${num(o.exitVWAP)}</span></div>
          <div class="mobile-stat"><span>Profit</span><span class="num ${profitClass(
            o.grossProfit,
          )}">${signed(o.grossProfit)}</span></div>
        </div>
        ${warnChips(o.warnings)}
      </article>`,
    )
    .join("");
}

function reasonPill(o) {
  const reason = nonActionableReason(o);
  return `<span class="pill" data-limit="${escapeHtml(reason.kind)}">${escapeHtml(reason.label)}</span>`;
}

function nonActionableReason(o) {
  if (!o.rankable) return { kind: "unrankable", label: "unrankable — no gold cost" };
  if (o.warnings?.includes("no-liquidity")) return { kind: "liquidity", label: "illiquid" };
  if (o.warnings?.includes("exit-not-executable")) return { kind: "liquidity", label: "exit can't execute" };
  if (Number.isFinite(o.grossProfit) && o.grossProfit < 0) return { kind: "loss", label: "negative" };
  if (!(o.quantity > 0)) return { kind: o.limitingResource, label: `no position (${o.limitingResource})` };
  return { kind: o.limitingResource, label: o.limitingResource };
}

function renderError() {
  setBadge("error", "Error");
  els.sourceLabel.textContent = "Source: none";
  els.updatedLabel.textContent = "Snapshot: failed";
  els.errorMessage.textContent = `${state.error.code}: ${state.error.message}`;
  els.errorPanel.hidden = false;
  els.tableBody.innerHTML = `<tr><td colspan="${COLSPAN}" class="empty-state">No data — source failed. Nothing fabricated.</td></tr>`;
  els.mobileList.innerHTML = "";
  els.nonActionableWrap.hidden = true;
}

function renderRow(o) {
  const spark = sparkline(seriesValues(o.targetCurrency, "spreadPct"));
  return `
    <tr data-target="${escapeHtml(o.targetCurrency)}">
      <td><div class="currency-cell">${iconImg(o.targetCurrency)}<div class="currency-name">
        <strong>${escapeHtml(o.targetName)}</strong>
        <span class="category">${escapeHtml(o.marketFreshness?.tier ?? "manual")} · updated ${formatAge(
          o.marketFreshness?.ageMs,
        )} ago</span></div></div></td>
      <td>${spark}</td>
      <td class="right num">${num(o.entryVWAP)}</td>
      <td class="right num">${num(o.exitVWAP)}</td>
      <td class="right num">${whole(o.quantity)}</td>
      <td class="right num ${profitClass(o.grossProfit)}">${signed(o.grossProfit)}</td>
      <td class="right num ${profitClass(o.grossProfit)}">${pct(o.currencyROI)}</td>
      <td class="right num">${whole(o.totalGold)}</td>
      <td class="right num ${profitClass(o.profitPer100kGold)}">${num(o.profitPer100kGold)}</td>
      <td>${limitPill(o.limitingResource)}${warnDots(o.warnings)}</td>
    </tr>`;
}

function renderCard(o) {
  const anchor = o.anchorCurrency ?? "";
  return `
    <article class="mobile-card" data-target="${escapeHtml(o.targetCurrency)}">
      <div class="mobile-card-top">
        <span class="currency-cell">${iconImg(o.targetCurrency)}<strong>${escapeHtml(o.targetName)}</strong></span>
        <strong class="${profitClass(o.profitPer100kGold)}">${num(o.profitPer100kGold)} ${escapeHtml(
          anchor,
        )} / 100k</strong>
      </div>
      ${sparkline(seriesValues(o.targetCurrency, "spreadPct"), { w: 260, h: 40 })}
      <div class="mobile-stats">
        <div class="mobile-stat"><span>Entry (${escapeHtml(anchor)})</span><span class="num">${num(
          o.entryVWAP,
        )}</span></div>
        <div class="mobile-stat"><span>Exit (${escapeHtml(anchor)})</span><span class="num">${num(
          o.exitVWAP,
        )}</span></div>
        <div class="mobile-stat"><span>Qty</span><span class="num">${whole(o.quantity)}</span></div>
        <div class="mobile-stat"><span>Profit (${escapeHtml(anchor)})</span><span class="num ${profitClass(
          o.grossProfit,
        )}">${signed(o.grossProfit)}</span></div>
        <div class="mobile-stat"><span>Gold</span><span class="num">${whole(o.totalGold)}</span></div>
        <div class="mobile-stat"><span>Limited by</span>${escapeHtml(o.limitingResource)}</div>
      </div>
      ${warnChips(o.warnings)}
    </article>`;
}

function bindRowClicks() {
  document.querySelectorAll("[data-target]").forEach((el) => {
    el.addEventListener("click", () => openDetail(el.dataset.target));
  });
}

/* ---------- detail modal ---------- */

function openDetail(targetId) {
  const o = state.data?.opportunities.find((x) => x.targetCurrency === targetId);
  if (!o) return;
  const radar = state.radar?.rows?.find((x) => x.target === targetId);

  els.modalAnchor.textContent = `${o.entryCurrency} → ${o.targetName} → ${o.exitCurrency}`;
  els.modalTitle.innerHTML = `${iconImg(o.targetCurrency)} ${escapeHtml(o.targetName)} round trip`;
  els.modalSummary.textContent = o.summary?.text ?? "";

  const points = state.history[targetId] ?? [];
  els.modalChart.hidden = true;
  els.modalChart.innerHTML = "";

  const sig = o.historySignal;
  const horizon = o.horizonHours;
  const coveragePct = sig ? num((sig.coverageFraction ?? 0) * 100) : "0";
  const sigRows =
    sig && sig.status === "ok"
      ? [
          [`Samples (${horizon}h)`, `${sig.samples}${sig.synthetic ? " · synthetic" : ""}`],
          ["Horizon coverage", `${coveragePct}% (${num(sig.spanHours)}h of ${horizon}h)`],
          ["Mean spread", `${num(sig.meanSpreadPct)}%`],
          ["Spread momentum", `${num(sig.spreadMomentumPctPerHour)} pp/h`],
          ["Spread volatility", `${num(sig.spreadVolatility)} pp`],
        ]
      : [
          [
            `History (${horizon}h)`,
            `insufficient — ${sig?.samples ?? 0} samples, ${coveragePct}% coverage (not fabricated)`,
          ],
        ];

  const advanced = [
    `<div class="modal-chart">${renderPriceChart(points)}</div>`,
    group("Prices (anchor per unit)", [
      ["Best entry", num(o.bestEntryPrice)],
      ["Entry VWAP", num(o.entryVWAP)],
      ["Best exit", num(o.bestExitPrice)],
      ["Exit VWAP", num(o.exitVWAP)],
      ["Headline spread", o.grossSpreadPercent == null ? "—" : `${num(o.grossSpreadPercent)}%`],
    ]),
    group("Position", [
      ["Recommended qty", whole(o.quantity)],
      ["Limited by", o.limitingResource],
      ["Max by capital", whole(o.sizing.maxByCapital)],
      ["Max by gold", o.sizing.maxByGold == null ? "—" : whole(o.sizing.maxByGold)],
      ["Max fully executable", whole(o.sizing.maxFullyExecutable)],
    ]),
    group(`Economics (${o.anchorCurrency})`, [
      ["Entry cost", num(o.entryCost)],
      ["Exit revenue", num(o.exitRevenue)],
      ["Gross profit", signed(o.grossProfit)],
      ["Currency ROI", pct(o.currencyROI)],
      ["Total gold / cycle", whole(o.totalGold)],
      ["Profit / 100k gold", num(o.profitPer100kGold)],
    ]),
    group(`History signal (${horizon}h, transparent — not a forecast)`, sigRows),
    group("Liquidity & freshness", [
      ["Entry depth", whole(o.depth.entry)],
      ["Exit depth", whole(o.depth.exit)],
      ["Snapshot age", o.freshness.ageMs == null ? "—" : `${formatAge(o.freshness.ageMs)}`],
      ["Stale", o.freshness.stale ? "yes" : "no"],
      ["Poll tier", o.marketFreshness?.tier ?? "manual"],
      ["Market fetched", o.marketFreshness?.ageMs == null ? "—" : `${formatAge(o.marketFreshness.ageMs)} ago`],
      ["Poll overdue", o.marketFreshness?.stale ? "yes" : "no"],
      ["Fill prob (1h/3h/6h)", "unavailable"],
    ]),
  ].join("");
  els.modalGroups.innerHTML = [
    group("Decision", [
      ["Position", `${whole(o.quantity)} ${o.targetName}`],
      ["Gross profit", `${signed(o.grossProfit)} ${o.anchorCurrency}`],
      ["Gold required", whole(o.totalGold)],
      ["Limited by", o.limitingResource],
      ["Hourly signal", radar ? radarSignalReason(radar) : "not available"],
      ["Book freshness", o.marketFreshness?.ageMs == null ? "unknown" : `${formatAge(o.marketFreshness.ageMs)} ago`],
    ]),
    `<details class="modal-advanced"><summary>Technical details</summary>${advanced}</details>`,
  ].join("");

  els.modalWarnings.innerHTML = o.warnings.length
    ? `<p class="warn-line">⚠ ${o.warnings.map(escapeHtml).join(" · ")}</p>`
    : "";

  els.modalBackdrop.hidden = false;
  els.detailModal.showModal();
}

function group(title, rows) {
  const body = rows
    .map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v))}</dd>`)
    .join("");
  return `<section class="detail-group"><h3>${escapeHtml(title)}</h3><dl class="detail-rows">${body}</dl></section>`;
}

function closeModal() {
  if (!els.detailModal.open) return;
  destroyRadarChart("radar-modal-chart");
  els.detailModal.close();
  els.modalBackdrop.hidden = true;
}

/* ---------- charts (inline SVG) ---------- */

function seriesValues(target, key) {
  return (state.history[target] ?? []).map((p) => p[key]).filter((v) => Number.isFinite(v));
}

function sparkline(values, opts = {}) {
  const w = opts.w ?? 88;
  const h = opts.h ?? 26;
  const pad = 3;
  const vals = values.filter((v) => Number.isFinite(v));
  if (vals.length < 2) return `<span class="spark-fallback">—</span>`;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const stepX = (w - pad * 2) / (vals.length - 1);
  const pts = vals.map((v, i) => {
    const x = pad + i * stepX;
    const y = pad + (h - pad * 2) * (1 - (v - min) / span);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const rising = vals[vals.length - 1] >= vals[0];
  const color = rising ? COLOR.up : COLOR.down;
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <polyline fill="none" stroke="${color}" stroke-width="1.75" stroke-linejoin="round" stroke-linecap="round" points="${pts.join(" ")}" />
  </svg>`;
}

function radarSparkline(points, opts = {}) {
  const values = (points ?? []).map((p) => Array.isArray(p) ? p[1] : p).filter(Number.isFinite);
  const w = opts.w ?? 112;
  const h = opts.h ?? 34;
  const pad = 3;
  if (values.length < 2) return `<span class="spark-fallback">—</span>`;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = (w - pad * 2) / (values.length - 1);
  const coords = values.map((value, index) => [
    pad + index * stepX,
    pad + (h - pad * 2) * (1 - (value - min) / span),
  ]);
  const line = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${pad},${h - pad} ${line} ${w - pad},${h - pad}`;
  const color = values[values.length - 1] >= values[0] ? COLOR.up : COLOR.down;
  return `<svg class="spark radar-spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="24 hour price trend">
    <polygon points="${area}" fill="${color}" opacity="0.12" />
    <polyline fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" points="${line}" />
  </svg>`;
}

function renderPriceChart(points) {
  const w = 588;
  const h = 168;
  const pad = { l: 8, r: 8, t: 16, b: 24 };
  const usable = points.filter((p) => Number.isFinite(p.bestEntry) && Number.isFinite(p.bestExit));
  if (usable.length < 2) {
    return `<p class="spark-fallback">Not enough history yet — trend appears after a few snapshots.</p>`;
  }
  const all = usable.flatMap((p) => [p.bestEntry, p.bestExit]);
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const t0 = usable[0].t;
  const t1 = usable[usable.length - 1].t;
  const dt = t1 - t0 || 1;
  const x = (t) => pad.l + (w - pad.l - pad.r) * ((t - t0) / dt);
  const y = (v) => pad.t + (h - pad.t - pad.b) * (1 - (v - min) / span);

  const line = (key, color) =>
    `<polyline fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"
       points="${usable.map((p) => `${x(p.t).toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ")}" />`;

  const synthetic = usable.some((p) => p.synthetic);
  // Axis labels live in HTML (not SVG <text>) so `preserveAspectRatio="none"`
  // can stretch the polylines to full width without distorting the text.
  return `
    <div class="chart-axis"><span>high ${num(max)}</span><span>low ${num(min)}</span></div>
    <svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="price trend">
      <line x1="${pad.l}" y1="${y(max).toFixed(1)}" x2="${w - pad.r}" y2="${y(max).toFixed(1)}" stroke="${COLOR.grid}" />
      <line x1="${pad.l}" y1="${y(min).toFixed(1)}" x2="${w - pad.r}" y2="${y(min).toFixed(1)}" stroke="${COLOR.grid}" />
      ${line("bestEntry", COLOR.entry)}
      ${line("bestExit", COLOR.exit)}
    </svg>
    <div class="chart-legend">
      <span><i style="background:${COLOR.entry}"></i>Entry (buy)</span>
      <span><i style="background:${COLOR.exit}"></i>Exit (sell)</span>
      <span class="chart-time">→ ${formatTime(new Date(t1).toISOString())}</span>
      ${synthetic ? '<span class="synthetic-tag">synthetic history</span>' : ""}
    </div>`;
}

function renderRadarChart(points, opts = {}) {
  const displayUnit = opts.displayUnit;
  const usable = radarChartRows(points, opts);
  if (usable.length < 2) return '<p class="spark-fallback">At least two completed hours are required.</p>';
  const chartId = opts.chartId ?? `radar-chart-${Math.random().toString(36).slice(2)}`;
  const height = opts.height ?? 360;
  const min = Math.min(...usable.map((p) => p.candle.low));
  const max = Math.max(...usable.map((p) => p.candle.high));
  const first = usable[0];
  const last = usable[usable.length - 1];
  const unitLabel = displayUnit ? ` ${displayUnit}` : "";
  scheduleRadarChartMount(chartId, {
    rows: usable,
    height,
    precision: chartPrecision(min, max),
  });
  return `<div class="market-chart-shell" data-radar-chart-id="${escapeHtml(chartId)}">
    <div class="market-chart-topline">
      <span>high ${num(max)}${escapeHtml(unitLabel)}</span>
      <span>${formatTime(new Date(first.time * 1000).toISOString())} → ${formatTime(new Date(last.time * 1000).toISOString())}</span>
      <span>low ${num(min)}${escapeHtml(unitLabel)}</span>
    </div>
    <div id="${escapeHtml(chartId)}" class="market-chart-host" style="height:${height}px"></div>
    <div class="chart-legend market-chart-legend">
      <span><i style="background:${CHART_COLOR.up}"></i>Up range candle</span>
      <span><i style="background:${CHART_COLOR.down}"></i>Down range candle</span>
      <span><i style="background:${CHART_COLOR.line}"></i>Hourly midpoint</span>
      <span>bars: volume</span>
    </div>
    <p class="market-chart-note">Candles are derived from official hourly low/high ranges. Body open/close follows the midpoint reference; this is not tick-level OHLC.</p>
  </div>`;
}

function radarChartRows(points, opts = {}) {
  const displayUnit = opts.displayUnit;
  const anchor = opts.anchor;
  const rate = opts.divineInExalted;
  return (points ?? [])
    .map((point) => {
      if (!displayUnit || !anchor || displayUnit === anchor) return point;
      const low = convertMarketPrice(point.low, anchor, displayUnit, rate);
      const high = convertMarketPrice(point.high, anchor, displayUnit, rate);
      const reference = convertMarketPrice(point.reference, anchor, displayUnit, rate);
      return { ...point, low, high, reference };
    })
    .filter((point) => Number.isFinite(point?.low) && Number.isFinite(point?.high) && Number.isFinite(point?.reference))
    .sort((a, b) => (a.completedHour ?? 0) - (b.completedHour ?? 0))
    .map((point, index, usable) => {
      const prior = usable[index - 1]?.reference ?? point.reference;
      const time = Math.floor((point.completedHour ?? Date.now()) / 1000);
      const volume = Number(point.volume?.[point.target] ?? point.volume?.[point.base] ?? 0);
      const up = point.reference >= prior;
      return {
        time,
        candle: {
          time,
          open: prior,
          high: Math.max(point.high, point.reference, prior),
          low: Math.min(point.low, point.reference, prior),
          close: point.reference,
        },
        midpoint: { time, value: point.reference },
        volume: {
          time,
          value: Number.isFinite(volume) ? volume : 0,
          color: up ? "rgba(14, 203, 129, 0.38)" : "rgba(246, 70, 93, 0.38)",
        },
      };
    });
}

function chartPrecision(min, max) {
  const magnitude = Math.max(Math.abs(min), Math.abs(max));
  if (magnitude < 0.01) return 6;
  if (magnitude < 1) return 4;
  if (magnitude < 100) return 3;
  return 2;
}

function scheduleRadarChartMount(chartId, payload) {
  queueMicrotask(() => mountRadarChart(chartId, payload));
}

function mountRadarChart(chartId, { rows, height, precision }) {
  const host = document.getElementById(chartId);
  if (!host || !host.isConnected) return;
  destroyRadarChart(chartId);
  host.replaceChildren();
  const minMove = 10 ** -precision;
  const chart = createChart(host, {
    height,
    autoSize: true,
    layout: {
      background: { color: CHART_COLOR.bg },
      textColor: CHART_COLOR.text,
      fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
    },
    grid: {
      vertLines: { color: CHART_COLOR.grid },
      horzLines: { color: CHART_COLOR.grid },
    },
    crosshair: {
      mode: 0,
      vertLine: { color: "rgba(240, 185, 11, 0.42)", labelBackgroundColor: CHART_COLOR.panel },
      horzLine: { color: "rgba(240, 185, 11, 0.42)", labelBackgroundColor: CHART_COLOR.panel },
    },
    rightPriceScale: {
      borderColor: CHART_COLOR.border,
      scaleMargins: { top: 0.08, bottom: 0.24 },
    },
    timeScale: {
      borderColor: CHART_COLOR.border,
      timeVisible: true,
      secondsVisible: false,
    },
  });

  const candles = chart.addSeries(CandlestickSeries, {
    upColor: CHART_COLOR.up,
    downColor: CHART_COLOR.down,
    borderUpColor: CHART_COLOR.up,
    borderDownColor: CHART_COLOR.down,
    wickUpColor: CHART_COLOR.up,
    wickDownColor: CHART_COLOR.down,
    priceFormat: { type: "price", precision, minMove },
  });
  candles.setData(rows.map((row) => row.candle));

  const midpoint = chart.addSeries(LineSeries, {
    color: CHART_COLOR.line,
    lineWidth: 2,
    priceLineVisible: false,
    lastValueVisible: false,
  });
  midpoint.setData(rows.map((row) => row.midpoint));

  const volume = chart.addSeries(HistogramSeries, {
    priceFormat: { type: "volume" },
    priceScaleId: "",
    base: 0,
  });
  volume.priceScale().applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });
  volume.setData(rows.map((row) => row.volume));

  chart.timeScale().fitContent();
  mountedRadarCharts.set(chartId, chart);
}

function destroyRadarChart(chartId) {
  const chart = mountedRadarCharts.get(chartId);
  if (!chart) return;
  chart.remove();
  mountedRadarCharts.delete(chartId);
}

function setChartHtml(container, html) {
  container?.querySelectorAll("[data-radar-chart-id]").forEach((node) => {
    const id = node.getAttribute("data-radar-chart-id");
    if (id) destroyRadarChart(id);
  });
  if (container) container.innerHTML = html;
}

/* ---------- helpers ---------- */

function sortRows(rows) {
  const key = state.sortKey;
  if (!key) return [...rows]; // preserve backend (horizon-aware) ordering
  const dir = state.sortDir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (typeof av === "string" || typeof bv === "string") {
      return String(av ?? "").localeCompare(String(bv ?? "")) * dir;
    }
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return (av - bv) * dir;
  });
}

function updateSortHeaders() {
  document.querySelectorAll("th[data-sort]").forEach((header) => {
    const active = header.dataset.sort === state.sortKey;
    header.dataset.active = active ? "true" : "false";
    header.dataset.direction = state.sortDir === "asc" ? "↑" : "↓";
  });
}

function updateAgeLabel() {
  if (state.snapshotAtMs == null || !state.data) return;
  const ageMs = Date.now() - state.snapshotAtMs;
  const stale = ageMs > state.pollIntervalMs;
  els.updatedLabel.textContent = `Snapshot: ${formatTime(state.data.snapshotAt)} · ${formatAge(ageMs)} ago${
    stale ? " · stale" : ""
  }`;
}

function setBadge(stateKey, text) {
  els.stateBadge.dataset.state = stateKey;
  els.stateBadge.textContent = text;
}

function limitPill(resource) {
  return `<span class="pill" data-limit="${escapeHtml(resource)}">${escapeHtml(resource)}</span>`;
}

function warnDots(warnings) {
  if (!warnings?.length) return "";
  return `<span class="warn-dots" title="${escapeHtml(warnings.join(", "))}">⚠ ${warnings.length}</span>`;
}

function warnChips(warnings) {
  if (!warnings?.length) return "";
  return `<div class="warn-chips">${warnings
    .map((w) => `<span class="warn-chip">${escapeHtml(w)}</span>`)
    .join("")}</div>`;
}

function profitClass(value) {
  if (value == null || !Number.isFinite(value)) return "profit-flat";
  if (value < 0) return "profit-down";
  if (value > 0) return "profit-up";
  return "profit-flat";
}

function num(value) {
  if (value == null || !Number.isFinite(value)) return "—";
  const a = Math.abs(value);
  // More fraction digits for small values (e.g. divine-anchored chaos prices)
  // so they don't collapse to "0".
  let max = 0;
  if (a !== 0 && a < 100) max = a >= 1 ? 2 : a >= 0.01 ? 4 : 6;
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: max }).format(value);
}
function signed(value) {
  if (value == null || !Number.isFinite(value)) return "—";
  const s = num(value);
  return value > 0 ? `+${s}` : s;
}
function whole(value) {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}
function hours(value) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value < 1) return `${Math.round(value * 60)}m`;
  const h = Math.floor(value);
  const m = Math.round((value - h) * 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}
function pct(value) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value * 100)}%`;
}
function pctSigned(value) {
  if (value == null || !Number.isFinite(value)) return "—";
  const valuePct = value * 100;
  return `${valuePct > 0 ? "+" : ""}${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(valuePct)}%`;
}
function ratioChange(value) {
  return Number.isFinite(value) ? pctSigned(value - 1) : "—";
}
function score(value, kind) {
  if (!Number.isFinite(value)) return '<span class="score muted">—</span>';
  return `<span class="score" data-score="${value >= 70 ? "high" : value >= 40 ? "mid" : "low"}" title="${escapeHtml(kind)} score">${num(value)}</span>`;
}
function formatTime(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "never";
  return new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function formatDateTime(iso) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "unknown";
}
function formatAge(ms) {
  if (!Number.isFinite(ms)) return "?";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const err = new Error(payload?.error?.message ?? `${res.status} ${res.statusText}`);
    err.payload = payload;
    throw err;
  }
  return payload;
}

function numVal(input, fallback) {
  const n = Number(input.value);
  return Number.isFinite(n) ? n : fallback;
}

function restoreControls() {
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
  } catch {
    return;
  }
  for (const id of CONTROLS) {
    const el = els[id];
    if (!el || saved[id] == null) continue;
    if (el.type === "checkbox") el.checked = Boolean(saved[id]);
    else el.value = saved[id];
  }
}

function persistControls() {
  const o = {};
  for (const id of CONTROLS) {
    const el = els[id];
    if (!el) continue;
    o[id] = el.type === "checkbox" ? el.checked : el.value;
  }
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(o));
  } catch {
    /* storage unavailable (private mode) — non-fatal */
  }
}

/* ---------- client-side filters + permalink (A6) ---------- */

function passesFilters(o) {
  const q = els.searchInput.value.trim().toLowerCase();
  if (q && !`${o.targetName} ${o.targetCurrency}`.toLowerCase().includes(q)) return false;
  if (els.minProfitInput.value !== "") {
    const min = Number(els.minProfitInput.value);
    if (Number.isFinite(min) && !(Number(o.grossProfit) >= min)) return false;
  }
  if (els.hideUnknownGoldInput.checked && o.warnings?.includes("unknown-gold-cost")) return false;
  if (els.hideStaleInput.checked && (o.freshness?.stale || o.marketFreshness?.stale)) return false;
  return true;
}

function anyFilterActive() {
  return (
    els.searchInput.value.trim() !== "" ||
    els.minProfitInput.value !== "" ||
    els.actionableOnlyInput.checked ||
    els.hideUnknownGoldInput.checked ||
    els.hideStaleInput.checked
  );
}

function syncUrl() {
  const params = new URLSearchParams();
  for (const [id, key] of Object.entries(PARAM_MAP)) {
    const el = els[id];
    if (!el) continue;
    if (el.type === "checkbox") {
      if (el.checked) params.set(key, "1");
    } else if (el.value !== "" && el.value != null) {
      params.set(key, el.value);
    }
  }
  const qs = params.toString();
  history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
}

function applyUrlParams() {
  const params = new URLSearchParams(location.search);
  if ([...params].length === 0) return; // no permalink -> keep restored/saved state
  // A permalink is AUTHORITATIVE for filters: an absent filter param means
  // "off/empty", so a recipient's saved filters don't bleed into the shared view.
  for (const [id, key] of Object.entries(PARAM_MAP)) {
    const el = els[id];
    if (!el) continue;
    if (el.type === "checkbox") {
      el.checked = params.get(key) === "1" || params.get(key) === "true";
    } else if (el.tagName === "SELECT") {
      if (params.has(key)) el.value = params.get(key); // selects keep saved/default if absent
    } else {
      el.value = params.has(key) ? params.get(key) : ""; // text/number filters cleared if absent
    }
  }
  // Deliberately NOT persisted: a shared permalink is transient. (Persisting here
  // would also clobber the saved anchor, since the anchor <select> has no options
  // yet.) Persistence happens when the user next edits a control.
}

async function copyShareLink() {
  syncUrl();
  try {
    await navigator.clipboard.writeText(location.href);
    const prev = els.copyLinkButton.textContent;
    els.copyLinkButton.textContent = "Copied!";
    setTimeout(() => (els.copyLinkButton.textContent = prev), 1200);
  } catch {
    /* clipboard unavailable */
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
