import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createMemoryRepository } from "../apps/web/lib/memory-repo.js";
import {
  GOLD_SOURCE_URL,
  LAYOUT_SOURCE_URLS,
  goldBaseline,
  layoutRowFor,
  refreshExchangeLayout,
  refreshGoldCosts,
  runDataRefresh,
} from "../apps/web/lib/data-refresh.js";
import { POE2_GOLD_COSTS } from "../src/data/gold-costs-poe2.js";
import { checkGoldVolatility } from "../src/domain/gold-costs-parse.js";

const NOW = Date.parse("2026-09-03T04:40:00Z");

const CONFIG = {
  poeGame: "poe2",
  poeRealm: "poe2",
  league: "Runes of Aldur",
  poe1League: "Standard",
  providerMode: "live",
  leagues: ["Runes of Aldur"],
  poe1Leagues: ["Standard"],
  anchorCurrency: "exalted",
  anchors: ["exalted"],
  cxapiStreams: [{ game: "poe2", realm: "poe2" }],
};
const SCOPE = { game: "poe2", realm: "poe2", league: "Runes of Aldur", mode: "live" };

const catalog = JSON.parse(readFileSync(new URL("../src/data/catalog-poe2.json", import.meta.url), "utf8"));
const layoutSnapshot = (game) =>
  JSON.parse(readFileSync(new URL(`../src/data/exchange-layout-${game}.json`, import.meta.url), "utf8"));

const escapeText = (value) =>
  String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** Same re-render as test/exchange-layout-parse.test.js, so the job sees real markup. */
function layoutHtml(items) {
  const parts = ["<h4>Currency Exchange</h4>"];
  let category = null;
  let section = null;
  for (const item of items) {
    if (item.category !== category) {
      category = item.category;
      section = null;
      parts.push(`<h5>${escapeText(category)}</h5>`);
    }
    if (item.section !== section) {
      section = item.section;
      parts.push(`<div class="currency-exchange-subtitle">${escapeText(section)}</div>`);
    }
    const hover = item.metadataId
      ? ` data-hover="?s=${encodeURIComponent(`Data\\BaseItemTypes\\${item.metadataId.replaceAll("/", "\\")}`)}"`
      : "";
    parts.push(
      '<div class="flex-grow-1 ms-2 d-flex justify-content-between align-items-center">'
      + `<a${hover} href="${escapeText(item.href ?? "")}">${escapeText(item.name)}</a>`
      + `<span>${escapeText(item.goldFeeText)}</span></div>`,
    );
  }
  return parts.join("");
}

function goldHtml(rows) {
  return rows
    .map(([itemId, displayName, goldPerUnit]) => {
      const hover = encodeURIComponent(`Data\\BaseItemTypes\\Metadata/Items/Currency/${itemId}`);
      return `<a data-hover="?s=${hover}" href="/us/${itemId}">${String(displayName).replaceAll("&", "&amp;")}</a><span>${goldPerUnit}</span>`;
    })
    .join("");
}

const COMMITTED_GOLD = POE2_GOLD_COSTS.map((record) => [record.itemId, record.displayName, record.goldPerUnit]);

const html = (body) => ({ ok: true, status: 200, text: async () => body });
const fetchStub = (byUrl, calls = []) => async (url) => {
  calls.push(url);
  const answer = byUrl[url];
  if (typeof answer === "function") return answer();
  if (answer == null) throw new Error(`unexpected fetch ${url}`);
  return html(answer);
};

const repoFor = () => {
  const repo = createMemoryRepository(SCOPE);
  return { repo, makeRepo: () => repo };
};

const base = (overrides = {}) => ({ config: CONFIG, now: NOW, ...overrides });

test("layout: a healthy page is stored, and the stored rows reproduce the parsed placement", async () => {
  const committed = layoutSnapshot("poe2");
  const { repo, makeRepo } = repoFor();
  const result = await refreshExchangeLayout(base({
    game: "poe2",
    makeRepo,
    fetchImpl: fetchStub({ [LAYOUT_SOURCE_URLS.poe2]: layoutHtml(committed.items) }),
  }));

  assert.equal(result.task, "layout");
  assert.equal(result.reason, null);
  assert.equal(result.scanned, committed.items.length);
  assert.equal(result.parsed, committed.items.length);
  assert.equal(result.skipped, 0);
  assert.equal(result.rejected, 0);
  assert.equal(result.written, committed.items.length);

  const stored = await repo.readExchangeLayout({ game: "poe2" });
  assert.equal(stored.length, committed.items.length);
  const byKey = new Map(stored.map((row) => [row.itemKey, row]));
  for (const item of committed.items) {
    const row = byKey.get(layoutRowFor(item).itemKey);
    assert.ok(row, `${item.name} was not stored`);
    assert.deepEqual(
      [row.category, row.section, row.categoryOrder, row.sectionOrder, row.itemOrder],
      [item.category, item.section, item.categoryOrder, item.sectionOrder, item.itemOrder],
    );
    assert.equal(row.source, LAYOUT_SOURCE_URLS.poe2);
  }
});

test("layout: a truncated page is refused by the coverage floor and writes nothing", async () => {
  const committed = layoutSnapshot("poe2");
  const { repo, makeRepo } = repoFor();
  // Half the items — plausible enough for the parser's own 20-item check, far
  // under 80% of what the committed file knows.
  const result = await refreshExchangeLayout(base({
    game: "poe2",
    makeRepo,
    fetchImpl: fetchStub({ [LAYOUT_SOURCE_URLS.poe2]: layoutHtml(committed.items.slice(0, 300)) }),
  }));

  assert.equal(result.reason, "coverage-floor");
  assert.equal(result.written, 0);
  assert.equal(result.rejected, 300);
  assert.ok(result.itemFloor > 300);
  assert.deepEqual(await repo.readExchangeLayout({ game: "poe2" }), []);
});

test("layout: a refused run leaves the PREVIOUS rows exactly as they were", async () => {
  const committed = layoutSnapshot("poe2");
  const { repo, makeRepo } = repoFor();
  await refreshExchangeLayout(base({
    game: "poe2",
    makeRepo,
    fetchImpl: fetchStub({ [LAYOUT_SOURCE_URLS.poe2]: layoutHtml(committed.items) }),
  }));
  const before = await repo.readExchangeLayout({ game: "poe2" });

  await refreshExchangeLayout(base({
    game: "poe2",
    makeRepo,
    fetchImpl: fetchStub({ [LAYOUT_SOURCE_URLS.poe2]: layoutHtml(committed.items.slice(0, 50)) }),
  }));
  assert.deepEqual(await repo.readExchangeLayout({ game: "poe2" }), before);
});

test("layout: the upstream fetch is retried once, then reported instead of thrown", async () => {
  const calls = [];
  const { repo, makeRepo } = repoFor();
  const result = await refreshExchangeLayout(base({
    game: "poe2",
    makeRepo,
    fetchImpl: fetchStub({ [LAYOUT_SOURCE_URLS.poe2]: () => { throw new Error("upstream down"); } }, calls),
  }));
  assert.equal(calls.length, 2, "one retry, not a storm");
  assert.equal(result.reason, "fetch-or-parse-failed");
  assert.equal(result.written, 0);
  assert.deepEqual(await repo.readExchangeLayout({ game: "poe2" }), []);
});

test("layout: a stored Metadata id survives a page that dropped data-hover", async () => {
  const committed = layoutSnapshot("poe2");
  const withMetadata = committed.items.find((item) => item.metadataId);
  const stripped = committed.items.map((item) =>
    item === withMetadata ? { ...item, metadataId: null } : item);
  const { repo, makeRepo } = repoFor();
  await refreshExchangeLayout(base({
    game: "poe2",
    makeRepo,
    fetchImpl: fetchStub({ [LAYOUT_SOURCE_URLS.poe2]: layoutHtml(stripped) }),
  }));
  const stored = await repo.readExchangeLayout({ game: "poe2" });
  const row = stored.find((entry) => entry.itemKey === withMetadata.metadataId);
  assert.ok(row, "preserveKnownMetadataIds must recover the id from the committed snapshot");
  assert.equal(row.metadataId, withMetadata.metadataId);
});

test("layout: PoE1 uses poedb, PoE2 uses poe2db — the same URLs the build script reads", async () => {
  const calls = [];
  const committed = layoutSnapshot("poe1");
  const { makeRepo } = repoFor();
  await refreshExchangeLayout(base({
    game: "poe1",
    makeRepo,
    fetchImpl: fetchStub({ [LAYOUT_SOURCE_URLS.poe1]: layoutHtml(committed.items) }, calls),
  }));
  assert.deepEqual(calls, ["https://poedb.tw/us/Currency_Exchange"]);
  assert.equal(LAYOUT_SOURCE_URLS.poe2, "https://poe2db.tw/us/Currency_Exchange");
});

test("gold: a healthy scrape is stored under trade short ids", async () => {
  const { repo, makeRepo } = repoFor();
  const result = await refreshGoldCosts(base({
    game: "poe2",
    makeRepo,
    catalog,
    fetchImpl: fetchStub({ [GOLD_SOURCE_URL]: goldHtml(COMMITTED_GOLD) }),
  }));

  assert.equal(result.task, "gold");
  assert.equal(result.reason, null);
  assert.equal(result.parsed, COMMITTED_GOLD.length);
  assert.equal(result.written, COMMITTED_GOLD.length);
  assert.equal(result.skipped, 0);

  const stored = await repo.readGoldCosts({ game: "poe2" });
  const byId = new Map(stored.map((row) => [row.itemKey, row]));
  assert.equal(byId.get("chaos").goldPerUnit, byId.get("chaos").goldPerUnit);
  for (const [itemId, displayName, goldPerUnit] of COMMITTED_GOLD) {
    assert.deepEqual(
      [byId.get(itemId)?.goldPerUnit, byId.get(itemId)?.displayName],
      [goldPerUnit, displayName],
      itemId,
    );
  }
});

test("gold: an unmatched item is omitted, never guessed", async () => {
  const { repo, makeRepo } = repoFor();
  const result = await refreshGoldCosts(base({
    game: "poe2",
    makeRepo,
    catalog,
    fetchImpl: fetchStub({
      [GOLD_SOURCE_URL]: goldHtml([...COMMITTED_GOLD, ["ignored", "Some Unlisted Relic", 4242]]),
    }),
  }));
  assert.equal(result.scanned, COMMITTED_GOLD.length + 1);
  assert.equal(result.parsed, COMMITTED_GOLD.length);
  assert.equal(result.skipped, 1);
  const stored = await repo.readGoldCosts({ game: "poe2" });
  assert.equal(stored.some((row) => row.goldPerUnit === 4242), false);
});

test("gold: a short page is refused by the coverage floor", async () => {
  const { repo, makeRepo } = repoFor();
  const result = await refreshGoldCosts(base({
    game: "poe2",
    makeRepo,
    catalog,
    fetchImpl: fetchStub({ [GOLD_SOURCE_URL]: goldHtml(COMMITTED_GOLD.slice(0, 100)) }),
  }));
  assert.match(result.reason, /^coverage-floor/);
  assert.equal(result.written, 0);
  assert.equal(result.rejected, 100);
  assert.deepEqual(await repo.readGoldCosts({ game: "poe2" }), []);
});

test("gold: the FIRST run is already compared against the committed table", async () => {
  const { repo, makeRepo } = repoFor();
  // Nothing stored yet, and the page has rescaled its whole table by 10x. With
  // no baseline this would apply; with the committed fallback it must not.
  const rescaled = COMMITTED_GOLD.map(([id, name, gold]) => [id, name, gold * 10]);
  const result = await refreshGoldCosts(base({
    game: "poe2",
    makeRepo,
    catalog,
    fetchImpl: fetchStub({ [GOLD_SOURCE_URL]: goldHtml(rescaled) }),
  }));
  assert.match(result.reason, /^volatility/);
  assert.equal(result.written, 0);
  assert.deepEqual(await repo.readGoldCosts({ game: "poe2" }), []);
});

test("gold: a rescale on a LATER run keeps every previously stored value", async () => {
  const { repo, makeRepo } = repoFor();
  await refreshGoldCosts(base({
    game: "poe2",
    makeRepo,
    catalog,
    fetchImpl: fetchStub({ [GOLD_SOURCE_URL]: goldHtml(COMMITTED_GOLD) }),
  }));
  const before = await repo.readGoldCosts({ game: "poe2" });

  const rescaled = COMMITTED_GOLD.map(([id, name, gold]) => [id, name, gold * 4]);
  const result = await refreshGoldCosts(base({
    game: "poe2",
    makeRepo,
    catalog,
    now: NOW + 86_400_000,
    fetchImpl: fetchStub({ [GOLD_SOURCE_URL]: goldHtml(rescaled) }),
  }));
  assert.match(result.reason, /^volatility/);
  assert.deepEqual(await repo.readGoldCosts({ game: "poe2" }), before);
});

test("gold: an ordinary patch changing a handful of fees applies", async () => {
  const { repo, makeRepo } = repoFor();
  await refreshGoldCosts(base({
    game: "poe2",
    makeRepo,
    catalog,
    fetchImpl: fetchStub({ [GOLD_SOURCE_URL]: goldHtml(COMMITTED_GOLD) }),
  }));

  // 40 items nudged by 20%; nothing moves by more than 50%, so nothing is big.
  const patched = COMMITTED_GOLD.map(([id, name, gold], index) =>
    index < 40 ? [id, name, Math.round(gold * 1.2)] : [id, name, gold]);
  const result = await refreshGoldCosts(base({
    game: "poe2",
    makeRepo,
    catalog,
    now: NOW + 86_400_000,
    fetchImpl: fetchStub({ [GOLD_SOURCE_URL]: goldHtml(patched) }),
  }));
  assert.equal(result.reason, null);
  assert.equal(result.bigMoves, 0);
  assert.ok(result.changed > 0 && result.changed <= 40);

  const stored = new Map((await repo.readGoldCosts({ game: "poe2" })).map((row) => [row.itemKey, row.goldPerUnit]));
  for (const [id, , gold] of patched) assert.equal(stored.get(id), gold, id);
});

test("gold: PoE1 has no scrapeable table and is skipped honestly", async () => {
  const calls = [];
  const { makeRepo } = repoFor();
  const result = await refreshGoldCosts(base({ game: "poe1", makeRepo, fetchImpl: fetchStub({}, calls) }));
  assert.equal(result.reason, "unsupported-game");
  assert.equal(result.written, 0);
  assert.deepEqual(calls, [], "no upstream is contacted for a game we cannot match");
});

test("without a database both jobs report no-database instead of pretending", async () => {
  const options = base({ makeRepo: () => null, fetchImpl: fetchStub({}) });
  assert.equal((await refreshExchangeLayout({ ...options, game: "poe2" })).reason, "no-database");
  assert.equal((await refreshGoldCosts({ ...options, game: "poe2" })).reason, "no-database");
});

test("goldBaseline lays stored rows over the committed table, never replacing it", () => {
  const committedBaseline = goldBaseline([]);
  assert.equal(committedBaseline.size, POE2_GOLD_COSTS.length);
  assert.equal(committedBaseline.get("chaos"), POE2_GOLD_COSTS.find((r) => r.itemId === "chaos").goldPerUnit);

  const stored = goldBaseline([{ itemKey: "chaos", goldPerUnit: 42 }]);
  assert.equal(stored.get("chaos"), 42, "a stored row wins for its own key");
  assert.equal(stored.size, POE2_GOLD_COSTS.length, "and does not drop the rest of the table");

  // A row with no usable number cannot become a baseline entry.
  assert.equal(goldBaseline([{ itemKey: "chaos", goldPerUnit: null }]).get("chaos"),
    POE2_GOLD_COSTS.find((r) => r.itemId === "chaos").goldPerUnit);
});

test("an interrupted first write cannot disarm the volatility guard", () => {
  // Upserts commit in independent batches, so a run that times out midway leaves
  // the table NON-EMPTY but PARTIAL. If that partial map were taken as the whole
  // baseline, every item it never reached would have no `before` value —
  // checkGoldVolatility skips those rather than counting them — and a rescaled
  // scrape would walk past the guard for exactly those items.
  const [first, ...rest] = POE2_GOLD_COSTS.filter((r) => Number.isFinite(r.goldPerUnit) && r.goldPerUnit > 0);
  const partiallyStored = [{ itemKey: first.itemId, goldPerUnit: first.goldPerUnit }];
  const baseline = goldBaseline(partiallyStored);

  const rescaled = rest.slice(0, 60).map((r) => [r.itemId, r.itemId, r.goldPerUnit * 10]);
  const verdict = checkGoldVolatility(rescaled, baseline);
  assert.equal(verdict.ok, false, "the items the interrupted run never wrote are still guarded");

  // The old either/or rule would have compared nothing at all here.
  const partialOnly = new Map(partiallyStored.map((r) => [r.itemKey, r.goldPerUnit]));
  assert.equal(checkGoldVolatility(rescaled, partialOnly).ok, true,
    "pinning the regression: a partial-only baseline sees zero changed items and waves it through");
});

test("PoE2's layout and gold are one page, fetched once per run", async () => {
  // https://poe2db.tw/us/Currency_Exchange is BOTH sources. The run must read it
  // once, so the two tasks describe the same snapshot and the fan site is asked
  // once rather than twice.
  assert.equal(GOLD_SOURCE_URL, LAYOUT_SOURCE_URLS.poe2);
  const committed = layoutSnapshot("poe2");
  const calls = [];
  const { makeRepo } = repoFor();
  await runDataRefresh({
    config: CONFIG,
    now: NOW,
    makeRepo,
    catalog,
    fetchImpl: fetchStub({ [LAYOUT_SOURCE_URLS.poe2]: layoutHtml(committed.items) }, calls),
  });
  assert.deepEqual(calls, [LAYOUT_SOURCE_URLS.poe2]);
});

test("runDataRefresh isolates every task: one game's failure cannot take the others down", async () => {
  const committed = layoutSnapshot("poe2");
  const { makeRepo } = repoFor();
  const results = await runDataRefresh({
    config: { ...CONFIG, cxapiStreams: [{ game: "poe2", realm: "poe2" }, { game: "poe1", realm: "poe1" }] },
    now: NOW,
    makeRepo,
    catalog,
    fetchImpl: fetchStub({
      [LAYOUT_SOURCE_URLS.poe2]: layoutHtml(committed.items),
      [LAYOUT_SOURCE_URLS.poe1]: () => { throw new Error("poedb down"); },
    }),
  });

  const find = (task, game) => results.find((entry) => entry.task === task && entry.game === game);
  assert.equal(find("layout", "poe2").written, committed.items.length, "poe2 succeeded despite poe1 failing");
  assert.equal(find("layout", "poe1").reason, "fetch-or-parse-failed");
  assert.equal(find("layout", "poe1").written, 0);
  assert.ok(find("gold", "poe2").written > 0, "gold still ran after a failed poe1 layout");
  assert.equal(find("gold", "poe1").reason, "unsupported-game");
});

test("runDataRefresh: a gold guard firing leaves the layout write alone", async () => {
  const committed = layoutSnapshot("poe2");
  const { repo, makeRepo } = repoFor();
  const results = await runDataRefresh({
    config: CONFIG,
    now: NOW,
    makeRepo,
    // An empty catalog means nothing can be matched by name, so the coverage
    // floor refuses the gold batch while the layout parse is unaffected.
    catalog: { items: [] },
    fetchImpl: fetchStub({ [LAYOUT_SOURCE_URLS.poe2]: layoutHtml(committed.items) }),
  });
  assert.equal(results.find((entry) => entry.task === "layout").written, committed.items.length);
  assert.match(results.find((entry) => entry.task === "gold").reason, /^coverage-floor/);
  assert.deepEqual(await repo.readGoldCosts({ game: "poe2" }), []);
  assert.equal((await repo.readExchangeLayout({ game: "poe2" })).length, committed.items.length);
});
