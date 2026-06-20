/**
 * Frontend: consumes the local backend only. No third-party CORS proxies, no
 * SAMPLE_ROWS fallback. A data failure renders as an explicit error state.
 * Charts are hand-rolled inline SVG (zero dependencies).
 *
 * Refresh semantics (honest, backend-controlled — A3):
 *   - users can NEVER trigger a provider fetch; the backend scheduler owns that;
 *   - the Refresh button and the automatic poll just re-read the cached snapshot;
 *   - a "warming" (503) cold start shows a soft retry, not a hard error;
 *   - a 1s ticker keeps the displayed snapshot age live;
 *   - overlapping loads are prevented by `state.loading`.
 */

const COLOR = { entry: "#9a7a37", exit: "#1d9a55", up: "#1d9a55", down: "#c2402f", grid: "#e7e0d0" };

const state = {
  config: null,
  data: null,
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
  "tableBody", "mobileList", "nonActionableWrap", "nonActionableSummary", "nonActionableBody",
  "nonActionableMobile", "profitUnit", "profit100kUnit", "modalBackdrop", "detailModal",
  "closeModal", "modalAnchor", "modalTitle", "modalSummary", "modalChart", "modalGroups", "modalWarnings",
]) {
  els[id] = document.getElementById(id);
}

const COLSPAN = 10;

// Controls that change the BACKEND query (re-read the snapshot).
const SERVER_CONTROLS = ["anchorInput", "capitalInput", "goldInput", "reserveInput", "horizonInput", "goldModeInput", "rankInput"];
// Controls that only filter/sort CLIENT-side (no backend round trip).
const FILTER_CONTROLS = [
  "searchInput", "minProfitInput", "actionableOnlyInput", "hideUnknownGoldInput", "hideStaleInput",
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
    state.config = await fetchJson("/api/config");
    state.pollIntervalMs = state.config.pollIntervalMs ?? state.pollIntervalMs;
    els.leagueLabel.textContent = `${state.config.league} · anchor: ${state.config.anchorCurrency}`;
    setUnits(state.config.anchorCurrency);
    renderGameLeague(state.config);
  } catch {
    els.leagueLabel.textContent = "Config unavailable";
  }
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

  try {
    const [data, hist] = await Promise.all([
      fetchJson(`/api/opportunities?${params.toString()}`),
      fetchJson(`/api/history${anchor ? `?anchor=${encodeURIComponent(anchor)}` : ""}`).catch(() => ({
        series: {},
      })),
    ]);
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
  } finally {
    state.loading = false;
    els.refreshButton.disabled = false;
    els.refreshButton.textContent = "Refresh";
  }
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

function render() {
  const d = state.data;
  if (!d) return;
  setUnits(d.anchorCurrency);

  setBadge(d.degraded ? "degraded" : d.state, d.degraded ? "Degraded" : d.state === "live" ? "Live" : "Fixture");
  els.sourceLabel.textContent = `Source: ${d.providerLabel}`;
  els.leagueLabel.textContent = `${d.league} · anchor: ${d.anchorCurrency}`;
  updateAgeLabel();

  const filtered = sortRows(d.opportunities.filter(passesFilters));
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

  els.modalAnchor.textContent = `${o.entryCurrency} → ${o.targetName} → ${o.exitCurrency}`;
  els.modalTitle.innerHTML = `${iconImg(o.targetCurrency)} ${escapeHtml(o.targetName)} round trip`;
  els.modalSummary.textContent = o.summary?.text ?? "";

  const points = state.history[targetId] ?? [];
  els.modalChart.innerHTML = renderPriceChart(points);

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

  els.modalGroups.innerHTML = [
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
function pct(value) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value * 100)}%`;
}
function formatTime(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "never";
  return new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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
