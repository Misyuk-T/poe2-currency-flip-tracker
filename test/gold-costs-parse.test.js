import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  MIN_MATCHED,
  REQUIRED_IDS,
  checkGoldCoverage,
  checkGoldVolatility,
  matchGoldCosts,
  parseGoldCostsHtml,
} from "../src/domain/gold-costs-parse.js";
import { mergeGoldRecords, createGoldRegistry } from "../src/domain/gold-costs.js";
import { POE2_GOLD_COSTS } from "../src/data/gold-costs-poe2.js";

const catalog = JSON.parse(readFileSync(new URL("../src/data/catalog-poe2.json", import.meta.url), "utf8"));

const escapeText = (value) => String(value).replaceAll("&", "&amp;");

/**
 * Re-render the committed gold table as the markup poe2db serves, so the SHARED
 * parser and matcher can be driven over the real, full-size data rather than a
 * toy fixture: 651 rows, the same names, through the same exact-name join
 * against the same committed catalog.
 */
function goldHtmlFromRecords(records) {
  const rows = records.map((record) => {
    const hover = encodeURIComponent(`Data\\BaseItemTypes\\Metadata/Items/Currency/${record.itemId}`);
    // The image anchor the real page renders first: it is followed by an <img>,
    // not a <span>, and must NOT match.
    const image = `<a data-hover="?s=${hover}" href="/us/${record.itemId}"><img src="x.png"></a>`;
    const text = `<a data-hover="?s=${hover}" href="/us/${record.itemId}">${escapeText(record.displayName)}</a><span>${record.goldPerUnit}</span>`;
    return image + text;
  });
  return `<div class="currency-exchange">${rows.join("")}</div>`;
}

test("the shared scrape + exact-name match reproduces the committed gold table exactly", () => {
  const html = goldHtmlFromRecords(POE2_GOLD_COSTS);
  const scraped = parseGoldCostsHtml(html);
  assert.equal(scraped.length, POE2_GOLD_COSTS.length, "the image anchor must not double-count an item");

  const { matched, unmatched } = matchGoldCosts(scraped, catalog);
  assert.deepEqual(unmatched, [], "every committed row came from a unique catalog name and must still match");

  // Every id, every display name and every gold value, in order — the three
  // fields a user's decision is actually made of.
  const expected = POE2_GOLD_COSTS.map((record) => [record.itemId, record.displayName, record.goldPerUnit]);
  assert.deepEqual(matched, expected);
  assert.equal(matched.length, 651);
});

test("the coverage floor is the same decision the build script has always made", () => {
  const expected = POE2_GOLD_COSTS.map((record) => [record.itemId, record.displayName, record.goldPerUnit]);
  assert.deepEqual(checkGoldCoverage(expected), { ok: true, reason: null, missingRequired: [] });

  const tooFew = expected.slice(0, MIN_MATCHED - 1);
  assert.equal(checkGoldCoverage(tooFew).ok, false);

  const withoutAnchors = expected.filter(([id]) => !REQUIRED_IDS.includes(id));
  const anchorless = checkGoldCoverage(withoutAnchors);
  assert.equal(anchorless.ok, false);
  assert.deepEqual(anchorless.missingRequired.sort(), [...REQUIRED_IDS].sort());
});

test("an ambiguous display name is dropped, never arbitrated", () => {
  const twins = { items: [{ id: "twin-a", name: "Twin Orb" }, { id: "twin-b", name: "Twin Orb" }] };
  const { matched, unmatched } = matchGoldCosts([{ name: "Twin Orb", goldPerUnit: 100 }], twins);
  assert.deepEqual(matched, []);
  assert.deepEqual(unmatched, ["Twin Orb"]);
});

test("volatility: a normal patch touching a few fees applies", () => {
  const baseline = new Map([["a", 100], ["b", 200], ["c", 300], ["d", 400]]);
  // One item up 10%, one down 25%: changed = 2, big moves = 0.
  const batch = [["a", "A", 110], ["b", "B", 150], ["c", "C", 300], ["d", "D", 400]];
  const verdict = checkGoldVolatility(batch, baseline);
  assert.deepEqual(
    [verdict.ok, verdict.compared, verdict.changed, verdict.bigMoves],
    [true, 4, 2, 0],
  );
});

test("volatility: a wholesale rescale is refused, and the reason names the ratio", () => {
  const baseline = new Map(Array.from({ length: 100 }, (_, i) => [`item-${i}`, 100]));
  // 20 items doubled, 30 nudged by 10%: 20/50 = 40% > 5%.
  const batch = Array.from({ length: 100 }, (_, i) => {
    if (i < 20) return [`item-${i}`, `Item ${i}`, 200];
    if (i < 50) return [`item-${i}`, `Item ${i}`, 110];
    return [`item-${i}`, `Item ${i}`, 100];
  });
  const verdict = checkGoldVolatility(batch, baseline);
  assert.equal(verdict.ok, false);
  assert.deepEqual([verdict.changed, verdict.bigMoves], [50, 20]);
  assert.match(verdict.reason, /20\/50/);
  assert.equal(verdict.examples.length, 5, "a rejection carries examples a human can eyeball");
});

test("volatility: the denominator is items that CHANGED, not the whole table", () => {
  // 30 of 651 items doubled would be 4.6% of the table — under 5% — but it is
  // 100% of what changed, which is exactly the rescale this guard exists for.
  const baseline = new Map(Array.from({ length: 651 }, (_, i) => [`item-${i}`, 100]));
  const batch = Array.from({ length: 651 }, (_, i) => [`item-${i}`, `Item ${i}`, i < 30 ? 500 : 100]);
  assert.equal(checkGoldVolatility(batch, baseline).ok, false);
});

test("volatility: nothing to compare is not a rejection", () => {
  // First run against an empty baseline, and a batch of ids the baseline does
  // not contain. Coverage is the gate there, not volatility.
  assert.equal(checkGoldVolatility([["a", "A", 100]], new Map()).ok, true);
  assert.equal(checkGoldVolatility([["a", "A", 100]], new Map([["z", 5]])).ok, true);
  assert.equal(checkGoldVolatility([], new Map([["a", 100]])).ok, true);
});

test("a stored row outranks the committed table per item, and leaves the rest alone", () => {
  const stored = [{ game: "poe2", itemId: "chaos", goldPerUnit: 999, displayName: null, effectiveFrom: "2026-09-03" }];
  const merged = mergeGoldRecords(POE2_GOLD_COSTS, stored);
  const registry = createGoldRegistry(merged, { game: "poe2" });
  const committed = createGoldRegistry(POE2_GOLD_COSTS, { game: "poe2" });

  assert.equal(registry.goldPerUnit("chaos"), 999);
  assert.equal(registry.record("chaos").displayName, committed.record("chaos").displayName,
    "a stored row with no label keeps the committed one");
  assert.equal(registry.goldPerUnit("divine"), committed.goldPerUnit("divine"));
  assert.equal(registry.ids().length, committed.ids().length, "an override adds no coverage it did not have");
  assert.equal(mergeGoldRecords(POE2_GOLD_COSTS, []), POE2_GOLD_COSTS);
});

test("a stored row without a usable number is ignored rather than ranking a NaN", () => {
  const merged = mergeGoldRecords(POE2_GOLD_COSTS, [
    { game: "poe2", itemId: "chaos", goldPerUnit: null },
    { game: "poe2", itemId: "divine", goldPerUnit: Number.NaN },
  ]);
  const registry = createGoldRegistry(merged, { game: "poe2" });
  const committed = createGoldRegistry(POE2_GOLD_COSTS, { game: "poe2" });
  assert.equal(registry.goldPerUnit("chaos"), committed.goldPerUnit("chaos"));
  assert.equal(registry.goldPerUnit("divine"), committed.goldPerUnit("divine"));
});
