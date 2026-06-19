const LEAGUE = "Runes of Aldur HC";
const REFRESH_SECONDS = 300;
const EXALTED_ID = "exalted";
const POE_ASSET_ROOT = "https://www.pathofexile.com";
const STATIC_URLS = [
  "https://www.pathofexile.com/api/trade2/data/static",
  "https://www.pathofexile.com/api/trade/data/static",
];
const EXCHANGE_URLS = [
  `https://www.pathofexile.com/api/trade2/exchange/poe2/${encodeURIComponent(LEAGUE)}`,
  `https://www.pathofexile.com/api/trade/exchange/${encodeURIComponent(LEAGUE)}`,
];
const FETCH_URLS = [
  "https://www.pathofexile.com/api/trade2/fetch",
  "https://www.pathofexile.com/api/trade/fetch",
];
const REQUEST_TIMEOUT_MS = 6500;
const SOURCE_TIMEOUT_MS = 10000;
const NINJA_URL = `https://poe.ninja/api/data/currencyoverview?league=${LEAGUE.replaceAll(
  " ",
  "+",
)}&type=Currency`;
const CATEGORY_LIMITS = {
  Currency: 30,
  Fragments: 18,
  Runes: 22,
  Essences: 18,
  Omens: 18,
};
const SAMPLE_ROWS = [
  {
    id: "sample-perfect-exalted",
    name: "Perfect Exalted Orb",
    category: "Currency",
    buy: 5.2,
    sell: 6.05,
    supply: 310,
    demand: 420,
    supplyTrend: "up",
    demandTrend: "up",
  },
  {
    id: "sample-lesser-storm-rune",
    name: "Lesser Storm Rune",
    category: "Runes",
    buy: 0.72,
    sell: 0.89,
    supply: 248,
    demand: 265,
    supplyTrend: "flat",
    demandTrend: "up",
  },
  {
    id: "sample-omen-dexterity",
    name: "Omen of Greater Dexterity",
    category: "Omens",
    buy: 1.35,
    sell: 1.55,
    supply: 178,
    demand: 246,
    supplyTrend: "down",
    demandTrend: "up",
  },
  {
    id: "sample-essence-haste",
    name: "Greater Essence of Haste",
    category: "Essences",
    buy: 0.41,
    sell: 0.48,
    supply: 222,
    demand: 228,
    supplyTrend: "up",
    demandTrend: "flat",
  },
  {
    id: "sample-crisis-fragment",
    name: "Ancient Crisis Fragment",
    category: "Fragments",
    buy: 2.1,
    sell: 2.24,
    supply: 96,
    demand: 131,
    supplyTrend: "flat",
    demandTrend: "down",
  },
  {
    id: "sample-chaos",
    name: "Chaos Orb",
    category: "Currency",
    buy: 0.09,
    sell: 0.092,
    supply: 920,
    demand: 860,
    supplyTrend: "up",
    demandTrend: "flat",
  },
  {
    id: "sample-glacial-rune",
    name: "Lesser Glacial Rune",
    category: "Runes",
    buy: 0.58,
    sell: 0.56,
    supply: 188,
    demand: 144,
    supplyTrend: "down",
    demandTrend: "down",
  },
];

const state = {
  rows: [],
  source: "waiting",
  lastUpdated: null,
  sortKey: "profit",
  sortDir: "desc",
  secondsLeft: REFRESH_SECONDS,
  loading: false,
  selected: null,
};

window.openCalculatorForId = (rowId) => {
  const row = state.rows.find((entry) => entry.id === rowId);
  if (row) openCalculator(row);
};

const els = {
  tableBody: document.querySelector("#tableBody"),
  mobileList: document.querySelector("#mobileList"),
  refreshButton: document.querySelector("#refreshButton"),
  retryButton: document.querySelector("#retryButton"),
  errorPanel: document.querySelector("#errorPanel"),
  errorMessage: document.querySelector("#errorMessage"),
  countdown: document.querySelector("#countdown"),
  sourceLabel: document.querySelector("#sourceLabel"),
  updatedLabel: document.querySelector("#updatedLabel"),
  profitFilter: document.querySelector("#profitFilter"),
  categoryFilter: document.querySelector("#categoryFilter"),
  skeletonTemplate: document.querySelector("#skeletonTemplate"),
  modalBackdrop: document.querySelector("#modalBackdrop"),
  modal: document.querySelector("#calculatorModal"),
  closeModal: document.querySelector("#closeModal"),
  modalCategory: document.querySelector("#modalCategory"),
  modalTitle: document.querySelector("#modalTitle"),
  capitalInput: document.querySelector("#capitalInput"),
  profitResult: document.querySelector("#profitResult"),
  modalStats: document.querySelector("#modalStats"),
};

document.addEventListener("DOMContentLoaded", () => {
  wireEvents();
  renderSkeleton();
  refreshData();
  setInterval(tickCountdown, 1000);
});

function wireEvents() {
  els.refreshButton.addEventListener("click", refreshData);
  els.retryButton.addEventListener("click", refreshData);
  els.profitFilter.addEventListener("input", render);
  els.categoryFilter.addEventListener("change", render);
  els.closeModal.addEventListener("click", closeCalculator);
  els.modalBackdrop.addEventListener("click", (event) => {
    if (event.target === els.modalBackdrop) closeCalculator();
  });
  els.capitalInput.addEventListener("input", updateCalculator);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeCalculator();
  });
  document.querySelectorAll("th[data-sort]").forEach((header) => {
    header.addEventListener("click", () => {
      const nextKey = header.dataset.sort;
      if (state.sortKey === nextKey) {
        state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      } else {
        state.sortKey = nextKey;
        state.sortDir = nextKey === "name" ? "asc" : "desc";
      }
      render();
    });
  });
}

async function refreshData() {
  if (state.loading) return;
  state.loading = true;
  els.refreshButton.disabled = true;
  els.refreshButton.textContent = "Refreshing...";
  els.errorPanel.hidden = true;

  if (!state.rows.length) renderSkeleton();

  try {
    const liveResult = await Promise.any([
      sourceAttempt(fetchNinjaRows, "poe.ninja fallback"),
      sourceAttempt(fetchOfficialRows, "Official GGG Trade API"),
    ]);
    setFreshRows(liveResult.rows, liveResult.source);
  } catch (error) {
    if (!state.rows.length || state.source.startsWith("Sample")) {
      setFreshRows(SAMPLE_ROWS, "Sample fallback - live APIs blocked");
    }
    showError(
      "Live exchange data could not be read from this browser. Showing sample rows until a refresh succeeds.",
    );
    render();
  } finally {
    state.loading = false;
    els.refreshButton.disabled = false;
    els.refreshButton.textContent = "Refresh now";
  }
}

async function sourceAttempt(fetcher, source) {
  const rows = await withTimeout(fetcher(), SOURCE_TIMEOUT_MS, `${source} timed out`);
  if (!rows.length) throw new Error(`${source} returned no usable listings.`);
  return { rows, source };
}

function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

function setFreshRows(rows, source) {
  state.rows = rows
    .filter((row) => Number.isFinite(row.buy) && Number.isFinite(row.sell) && row.buy > 0)
    .map((row) => ({
      ...row,
      spread: row.sell - row.buy,
      profit: ((row.sell - row.buy) / row.buy) * 100,
    }));
  state.source = source;
  state.lastUpdated = new Date();
  state.secondsLeft = REFRESH_SECONDS;
  render();
}

async function fetchOfficialRows() {
  const staticData = await fetchStaticItems();
  const watchlist = buildWatchlist(staticData);
  const rows = [];

  await runLimited(watchlist, 4, async (item) => {
    const [buy, sell] = await Promise.all([
      fetchOfficialPrice(item, "buy"),
      fetchOfficialPrice(item, "sell"),
    ]);
    if (!buy || !sell) return;
    rows.push({
      id: item.id,
      name: item.text,
      category: item.category,
      image: item.image,
      buy: buy.price,
      sell: sell.price,
      supply: buy.volume,
      demand: sell.volume,
      supplyTrend: buy.trend,
      demandTrend: sell.trend,
    });
  });

  return rows;
}

async function fetchStaticItems() {
  let lastError;
  for (const url of STATIC_URLS) {
    try {
      const payload = await fetchJson(url);
      return payload.result ?? [];
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("Static item list unavailable.");
}

function buildWatchlist(groups) {
  const wanted = new Map([
    ["Currency", ["Currency"]],
    ["Fragments", ["Fragments"]],
    ["Runes", ["Runes"]],
    ["Essences", ["Essences", "Essence"]],
    ["Omens", ["Omens", "Omen"]],
  ]);
  const items = [];

  for (const [category, labels] of wanted) {
    const group = groups.find((entry) =>
      labels.some((label) => entry.id === label || entry.label === label),
    );
    if (!group?.entries?.length) continue;
    const cleanEntries = group.entries
      .filter((entry) => entry.id && entry.id !== EXALTED_ID && entry.text)
      .filter((entry, index, all) => all.findIndex((candidate) => candidate.id === entry.id) === index)
      .slice(0, CATEGORY_LIMITS[category])
      .map((entry) => ({
        id: entry.id,
        text: entry.text,
        image: absoluteImage(entry.image),
        category,
      }));
    items.push(...cleanEntries);
  }

  return items;
}

async function fetchOfficialPrice(item, mode) {
  const have = mode === "buy" ? EXALTED_ID : item.id;
  const want = mode === "buy" ? item.id : EXALTED_ID;
  const query = {
    exchange: {
      status: { option: "online" },
      have: [have],
      want: [want],
    },
    sort: { have: "asc" },
  };

  const exchange = await postFirstJson(EXCHANGE_URLS, query);
  const ids = (exchange.result ?? []).slice(0, 10);
  if (!exchange.id || !ids.length) return null;

  const listings = await fetchListings(ids, exchange.id);
  const offers = (listings.result ?? [])
    .flatMap((entry) => entry.listing?.offers ?? [])
    .map((offer) => parseOffer(offer, item.id))
    .filter(Boolean);

  if (!offers.length) return null;
  offers.sort((a, b) => (mode === "buy" ? a.price - b.price : b.price - a.price));

  const prices = offers.slice(0, 5).map((offer) => offer.price);
  return {
    price: median(prices),
    volume: offers.reduce((sum, offer) => sum + offer.targetAmount, 0),
    trend: trendFromPrices(prices, mode),
  };
}

async function postFirstJson(urls, body) {
  let lastError;
  for (const url of urls) {
    try {
      return await fetchJson(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("Exchange request failed.");
}

async function fetchListings(ids, queryId) {
  let lastError;
  for (const base of FETCH_URLS) {
    try {
      return await fetchJson(`${base}/${ids.join(",")}?query=${queryId}&exchange`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("Listing fetch failed.");
}

function parseOffer(offer, targetId) {
  const exchange = offer.exchange;
  const item = offer.item;
  if (!exchange || !item) return null;

  const exchangeCurrency = exchange.currency;
  const itemCurrency = item.currency;
  const exchangeAmount = Number(exchange.amount);
  const itemAmount = Number(item.amount);
  if (!exchangeAmount || !itemAmount) return null;

  if (exchangeCurrency === EXALTED_ID && itemCurrency === targetId) {
    return { price: exchangeAmount / itemAmount, targetAmount: itemAmount };
  }
  if (itemCurrency === EXALTED_ID && exchangeCurrency === targetId) {
    return { price: itemAmount / exchangeAmount, targetAmount: exchangeAmount };
  }
  return null;
}

async function fetchNinjaRows() {
  const payload = await fetchJson(NINJA_URL);
  const lines = payload.lines ?? [];
  const exaltedLine = lines.find((line) => line.currencyTypeName === "Exalted Orb");
  const exaltedChaosValue = Number(exaltedLine?.chaosEquivalent || 1);
  return lines
    .filter(
      (line) =>
        line.currencyTypeName &&
        line.currencyTypeName !== "Exalted Orb" &&
        line.chaosEquivalent > 0,
    )
    .map((line) => {
      const buyChaos = Number(line.receive?.value ?? line.chaosEquivalent);
      const sellChaos = Number(line.pay?.value ?? line.chaosEquivalent);
      const supply = Number(line.receive?.count ?? line.listingCount ?? 0);
      const demand = Number(line.pay?.count ?? line.listingCount ?? 0);
      return {
        id: line.detailsId ?? line.currencyTypeName,
        name: line.currencyTypeName,
        category: "Currency",
        image: line.icon,
        buy: buyChaos / exaltedChaosValue,
        sell: sellChaos / exaltedChaosValue,
        supply,
        demand,
        supplyTrend: trendFromChange(line.receiveSparkLine?.totalChange),
        demandTrend: trendFromChange(line.paySparkLine?.totalChange),
      };
    });
}

async function fetchJson(url, options) {
  const attempts = [url];
  const isGet = !options?.method || options.method.toUpperCase() === "GET";
  if (isGet) {
    attempts.push(
      `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
      `https://corsproxy.io/?${encodeURIComponent(url)}`,
    );
  }

  let lastError;
  for (const attempt of attempts) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(attempt, { ...options, signal: controller.signal });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`.trim());
      }
      return response.json();
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
  throw lastError ?? new Error("Request failed.");
}

async function runLimited(items, limit, worker) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      try {
        await worker(item);
      } catch {
        // Individual pair failures are expected when an item has no live book.
      }
    }
  });
  await Promise.all(workers);
}

function render() {
  const filtered = getVisibleRows();
  const bestIds = new Set(
    [...state.rows]
      .filter((row) => row.profit > 0)
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 3)
      .map((row) => row.id),
  );

  if (!filtered.length) {
    renderEmpty();
  } else {
    els.tableBody.innerHTML = filtered.map((row) => renderRow(row, bestIds.has(row.id))).join("");
    els.mobileList.innerHTML = filtered.map((row) => renderCard(row, bestIds.has(row.id))).join("");
  }
  bindCalculatorTargets();
  updateSortHeaders();
  updateMeta();
}

function getVisibleRows() {
  const minProfit = Number(els.profitFilter.value || 0);
  const category = els.categoryFilter.value;
  return [...state.rows]
    .filter((row) => row.profit >= minProfit)
    .filter((row) => category === "All" || row.category === category)
    .sort((a, b) => compareRows(a, b));
}

function compareRows(a, b) {
  const direction = state.sortDir === "asc" ? 1 : -1;
  const key = state.sortKey;
  if (key === "name") return a.name.localeCompare(b.name) * direction;
  return ((a[key] ?? 0) - (b[key] ?? 0)) * direction;
}

function renderRow(row, isBest) {
  return `
    <tr data-row-id="${escapeHtml(row.id)}" onclick="window.openCalculatorForId(this.dataset.rowId)">
      <td>${renderCurrency(row, isBest)}</td>
      <td>${formatEx(row.buy)}</td>
      <td>${formatEx(row.sell)}</td>
      <td class="${profitClass(row.profit)}">${formatPercent(row.profit)}</td>
      <td>${renderMetric(row.supply, row.supplyTrend)}</td>
      <td>${renderMetric(row.demand, row.demandTrend)}${renderLiquidity(row)}</td>
      <td><button class="button" data-open-calculator data-id="${escapeHtml(row.id)}" onclick="event.stopPropagation(); window.openCalculatorForId(this.dataset.id)" type="button">Calculate</button></td>
    </tr>
  `;
}

function renderCard(row, isBest) {
  return `
    <article class="mobile-card" data-row-id="${escapeHtml(row.id)}" onclick="window.openCalculatorForId(this.dataset.rowId)">
      <div class="mobile-card-top">
        ${renderCurrency(row, isBest)}
        <strong class="${profitClass(row.profit)}">${formatPercent(row.profit)}</strong>
      </div>
      <div class="mobile-stats">
        <div class="mobile-stat"><span>Buy</span>${formatEx(row.buy)}</div>
        <div class="mobile-stat"><span>Sell</span>${formatEx(row.sell)}</div>
        <div class="mobile-stat"><span>Supply</span>${renderMetric(row.supply, row.supplyTrend)}</div>
        <div class="mobile-stat"><span>Demand</span>${renderMetric(row.demand, row.demandTrend)}</div>
      </div>
      ${renderLiquidity(row)}
      <button class="button" data-open-calculator data-id="${escapeHtml(row.id)}" onclick="event.stopPropagation(); window.openCalculatorForId(this.dataset.id)" type="button">Calculate</button>
    </article>
  `;
}

function renderCurrency(row, isBest) {
  const badge = isBest ? '<span class="badge">🔥 Best Flip</span>' : "";
  return `
    <div class="currency-cell">
      ${row.image ? `<img class="currency-icon" src="${escapeHtml(row.image)}" alt="" />` : ""}
      <div class="currency-name">
        <strong>${escapeHtml(row.name)}${badge}</strong>
        <span class="category">${escapeHtml(row.category)}</span>
      </div>
    </div>
  `;
}

function renderMetric(value, trend) {
  return `
    <span class="metric">
      <strong>${formatWhole(value)}</strong>
      <span class="${trendClass(trend)}">${trendArrow(trend)}</span>
    </span>
  `;
}

function renderLiquidity(row) {
  return row.supply > 200 && row.demand > 200
    ? '<div class="liquidity-badge">High liquidity</div>'
    : "";
}

function updateSortHeaders() {
  document.querySelectorAll("th[data-sort]").forEach((header) => {
    const active = header.dataset.sort === state.sortKey;
    header.dataset.active = active ? "true" : "false";
    header.dataset.direction = state.sortDir === "asc" ? "↑" : "↓";
  });
}

function updateMeta() {
  els.sourceLabel.textContent = `Source: ${state.source}`;
  els.updatedLabel.textContent = state.lastUpdated
    ? `Last updated: ${state.lastUpdated.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })}`
    : "Last updated: never";
  els.countdown.textContent = formatCountdown(state.secondsLeft);
}

function renderSkeleton() {
  els.mobileList.innerHTML = "";
  els.tableBody.innerHTML = Array.from({ length: 9 }, () => els.skeletonTemplate.innerHTML).join("");
}

function renderEmpty() {
  const message = state.rows.length
    ? "No flips match the current filters."
    : "No live exchange data is loaded yet. Try Refresh now in a moment.";
  els.tableBody.innerHTML = `
    <tr>
      <td colspan="7" class="empty-state">${message}</td>
    </tr>
  `;
  els.mobileList.innerHTML = `<div class="empty-state">${message}</div>`;
}

function bindCalculatorTargets() {
  document.querySelectorAll("[data-row-id]").forEach((target) => {
    target.addEventListener("click", () => {
      const row = state.rows.find((entry) => entry.id === target.dataset.rowId);
      if (row) openCalculator(row);
    });
  });
  document.querySelectorAll("[data-open-calculator]").forEach((target) => {
    target.addEventListener("click", (event) => {
      event.stopPropagation();
      const row = state.rows.find((entry) => entry.id === target.dataset.id);
      if (row) openCalculator(row);
    });
  });
}

function showError(message) {
  els.errorMessage.textContent = message;
  els.errorPanel.hidden = false;
}

function tickCountdown() {
  state.secondsLeft -= 1;
  if (state.secondsLeft <= 0) {
    state.secondsLeft = REFRESH_SECONDS;
    refreshData();
  }
  els.countdown.textContent = formatCountdown(state.secondsLeft);
}

function openCalculator(row) {
  state.selected = row;
  els.modalCategory.textContent = row.category;
  els.modalTitle.textContent = `${row.name} calculator`;
  els.modalStats.innerHTML = `
    <div class="modal-stat"><span>Buy</span>${formatEx(row.buy)}</div>
    <div class="modal-stat"><span>Sell</span>${formatEx(row.sell)}</div>
    <div class="modal-stat"><span>Spread</span>${formatEx(row.spread)}</div>
  `;
  updateCalculator();
  els.modalBackdrop.hidden = false;
  els.modal.showModal();
  els.capitalInput.focus();
}

function closeCalculator() {
  if (!els.modal.open) return;
  els.modal.close();
  els.modalBackdrop.hidden = true;
  state.selected = null;
}

function updateCalculator() {
  if (!state.selected) return;
  const capital = Number(els.capitalInput.value || 0);
  const fullCycles = Math.floor(capital / state.selected.buy);
  const profit = fullCycles * state.selected.spread;
  els.profitResult.textContent = `${formatNumber(profit)} Ex`;
}

function formatCountdown(seconds) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const secs = Math.max(0, seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${secs}`;
}

function formatEx(value) {
  return `${formatNumber(value)} Ex`;
}

function formatPercent(value) {
  return `${formatNumber(value)}%`;
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return "-";
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value);
}

function formatWhole(value) {
  if (!Number.isFinite(value)) return "0";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}

function profitClass(value) {
  if (value < 0) return "profit-loss";
  if (value > 10) return "profit-high";
  if (value >= 5) return "profit-mid";
  return "profit-low";
}

function trendClass(trend) {
  return trend === "up" ? "trend-up" : trend === "down" ? "trend-down" : "trend-flat";
}

function trendArrow(trend) {
  if (trend === "up") return "↑";
  if (trend === "down") return "↓";
  return "→";
}

function trendFromPrices(prices, mode) {
  if (prices.length < 2) return "flat";
  const first = prices[0];
  const last = prices[prices.length - 1];
  if (Math.abs(first - last) < 0.0001) return "flat";
  const ascending = last > first;
  return mode === "buy" ? (ascending ? "down" : "up") : ascending ? "up" : "down";
}

function trendFromChange(change) {
  const value = Number(change);
  if (!Number.isFinite(value) || Math.abs(value) < 0.01) return "flat";
  return value > 0 ? "up" : "down";
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function absoluteImage(path) {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  return `${POE_ASSET_ROOT}${path}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}
