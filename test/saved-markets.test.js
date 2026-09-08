import test from "node:test";
import assert from "node:assert/strict";
import {
  SAVED_MARKETS_LIMIT,
  addSavedMarket,
  emptySavedMarketScope,
  clearSavedMarketVisitBaseline,
  readSavedMarketScope,
  reconcileSavedMarkets,
  saveSavedMarket,
  savedMarketScopeId,
  isSavedMarketScopeState,
  savedMarketComparison,
  savedMarketId,
  savedMarketScopeKey,
  writeSavedMarketScope,
} from "../apps/web/lib/saved-markets.js";

const HOUR = 60 * 60 * 1000;
const NOW = 1_800_000_000_000;
const scope = { game: "poe2", league: "Forbidden Rites" };

class Store {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, value); }
}

function row({ target = "divine", anchor = "exalted", reference = 125, completedHour = NOW - HOUR, ...rest } = {}) {
  return {
    pairId: `${target}|${anchor}`,
    target,
    anchor,
    reference,
    referenceKind: "hourly-traded-volume-ratio",
    latestCompletedHour: completedHour,
    ...rest,
  };
}

function radar(rows, extra = {}) {
  return { game: scope.game, league: scope.league, rows, ...extra };
}

test("saved markets are exact scoped identities and stay bounded to thirty", () => {
  let value = emptySavedMarketScope();
  for (let i = 0; i < SAVED_MARKETS_LIMIT; i++) {
    const result = addSavedMarket(value, scope, row({ target: `currency-${i}` }), { now: NOW });
    assert.equal(result.ok, true);
    value = result.value;
  }
  assert.equal(addSavedMarket(value, scope, row({ target: "one-too-many" }), { now: NOW }).ok, false);
  const inverse = addSavedMarket(emptySavedMarketScope(), scope, row({ anchor: "divine", target: "exalted" }), { now: NOW });
  assert.equal(inverse.value.saved[0].anchor, "divine");
  assert.notEqual(savedMarketId(value.saved[0]), savedMarketId(inverse.value.saved[0]));
});

test("malformed, version-mismatched, and blocked local storage never create a fake save", () => {
  const storage = new Store();
  storage.setItem("poe2flip.saved-markets.v1:poe2:Forbidden%20Rites", "{bad json");
  assert.match(readSavedMarketScope(storage, scope).error, /invalid|unavailable/i);
  storage.setItem("poe2flip.saved-markets.v1:poe2:Forbidden%20Rites", JSON.stringify({ version: 1, saved: [], observations: { unknown: row() } }));
  assert.match(readSavedMarketScope(storage, scope).error, /invalid/i);
  const blocked = { getItem: () => null, setItem: () => { throw new Error("blocked"); } };
  assert.equal(writeSavedMarketScope(blocked, scope, emptySavedMarketScope()).ok, false);
});

test("oversized valid saved-market payloads preserve the previous storage value", () => {
  const storage = new Store();
  const longScope = { game: "g".repeat(160), league: "l".repeat(160) };
  const saved = Array.from({ length: SAVED_MARKETS_LIMIT }, (_, index) => {
    const target = `${"t".repeat(156)}${String(index).padStart(3, "0")}`;
    const anchor = `${"a".repeat(156)}${String(index).padStart(3, "0")}`;
    return { game: longScope.game, league: longScope.league, target, anchor, savedAt: NOW };
  });
  const observations = Object.fromEntries(saved.map((entry) => [savedMarketId(entry), {
    ...entry, reference: 1, referenceKind: "hourly-traded-volume-ratio", completedHour: NOW - HOUR,
  }]));
  const key = savedMarketScopeKey(longScope);
  storage.setItem(key, "previous");
  const result = writeSavedMarketScope(storage, longScope, { version: 1, saved, observations });
  assert.equal(result.ok, false);
  assert.match(result.error, /storage is full/i);
  assert.equal(storage.getItem(key), "previous");
});

test("first matching response freezes prior observations before advancing the persistent hour", () => {
  const localStorage = new Store();
  const sessionStorage = new Store();
  const saved = addSavedMarket(emptySavedMarketScope(), scope, row({ reference: 100, completedHour: NOW - 2 * HOUR }), { now: NOW - HOUR });
  assert.equal(writeSavedMarketScope(localStorage, scope, saved.value).ok, true);

  const first = reconcileSavedMarkets({ localStorage, sessionStorage, scope, radar: radar([row({ reference: 120 })]), now: NOW });
  assert.equal(first.returned, true);
  const id = savedMarketId(saved.value.saved[0]);
  assert.equal(first.baseline[id].reference, 100);
  assert.equal(first.value.observations[id].reference, 120);

  const reload = reconcileSavedMarkets({ localStorage, sessionStorage, scope, radar: radar([row({ reference: 140, completedHour: NOW } )]), now: NOW });
  assert.equal(reload.returned, false);
  assert.equal(reload.baseline[id].reference, 100);
  assert.equal(reload.value.observations[id].reference, 140);
});

test("scope mismatch and delayed older radar responses cannot advance or downgrade observations", () => {
  const localStorage = new Store();
  const sessionStorage = new Store();
  const saved = addSavedMarket(emptySavedMarketScope(), scope, row({ reference: 100, completedHour: NOW - 2 * HOUR }), { now: NOW - HOUR });
  writeSavedMarketScope(localStorage, scope, saved.value);
  const mismatch = reconcileSavedMarkets({ localStorage, sessionStorage, scope, radar: { ...radar([row({ reference: 190 })]), league: "Other" }, now: NOW });
  assert.equal(mismatch.matched, false);
  const fresh = reconcileSavedMarkets({ localStorage, sessionStorage, scope, radar: radar([row({ reference: 140 })]), now: NOW });
  const old = reconcileSavedMarkets({ localStorage, sessionStorage, scope, radar: radar([row({ reference: 110, completedHour: NOW - 2 * HOUR })]), now: NOW });
  const id = savedMarketId(saved.value.saved[0]);
  assert.equal(fresh.value.observations[id].reference, 140);
  assert.equal(old.value.observations[id].reference, 140);
});

test("an old radar row cannot be saved into a newly selected game or league scope", () => {
  const storage = new Store();
  const nextScope = { game: "poe2", league: "Standard" };
  const oldRadar = radar([row({ reference: 125 })]);
  const result = saveSavedMarket({ storage, scope: nextScope, radar: oldRadar, row: oldRadar.rows[0], now: NOW });
  assert.equal(result.ok, false);
  assert.match(result.error, /current market data/i);
  assert.deepEqual(readSavedMarketScope(storage, nextScope).value, emptySavedMarketScope());
  assert.equal(isSavedMarketScopeState({ scopeKey: savedMarketScopeId(scope), saved: [{ target: "divine" }] }, nextScope), false);
});

test("comparison requires a fresh positive hourly traded-volume reference and a newer exact-anchor hour", () => {
  const saved = { game: scope.game, league: scope.league, target: "divine", anchor: "exalted", savedAt: NOW - HOUR };
  const id = savedMarketId(saved);
  const baseline = { [id]: { ...saved, reference: 100, referenceKind: "hourly-traded-volume-ratio", completedHour: NOW - 2 * HOUR } };
  const stale = savedMarketComparison({ saved, baseline, radar: radar([row({ reference: 120, completedHour: NOW - 3 * HOUR, stale: false })]), scope, now: NOW });
  assert.equal(stale.state, "current-unavailable");
  const edgeFresh = savedMarketComparison({ saved, baseline, radar: radar([row({ reference: 120, completedHour: NOW - 2 * HOUR })]), scope, now: NOW });
  assert.equal(edgeFresh.state, "waiting");
  const edgeStale = savedMarketComparison({ saved, baseline, radar: radar([row({ reference: 120, completedHour: NOW - 2 * HOUR - 1 })]), scope, now: NOW });
  assert.equal(edgeStale.state, "current-unavailable");
  const explicitlyStale = savedMarketComparison({ saved, baseline, radar: radar([row({ reference: 120, stale: true })]), scope, now: NOW });
  assert.equal(explicitlyStale.state, "current-unavailable");
  const equal = savedMarketComparison({ saved, baseline, radar: radar([row({ reference: 120, completedHour: NOW - 2 * HOUR })]), scope, now: NOW });
  assert.equal(equal.state, "waiting");
  const changed = savedMarketComparison({ saved, baseline, radar: radar([row({ reference: 125 })]), scope, now: NOW });
  assert.equal(changed.state, "changed");
  assert.equal(changed.change, 0.25);
  const wrongKind = savedMarketComparison({ saved, baseline, radar: radar([row({ referenceKind: "range-center" })]), scope, now: NOW });
  assert.equal(wrongKind.state, "current-unavailable");
  const changedAnchor = savedMarketComparison({ saved, baseline, radar: radar([row({ anchor: "divine", target: "divine" })]), scope, now: NOW });
  assert.equal(changedAnchor.state, "anchor-changed");
});

test("a newly saved market has no baseline for the current tab visit", () => {
  const added = addSavedMarket(emptySavedMarketScope(), scope, row(), { now: NOW });
  const saved = added.value.saved[0];
  const comparison = savedMarketComparison({ saved, baseline: {}, radar: radar([row({ completedHour: NOW })]), scope, now: NOW });
  assert.equal(comparison.state, "new");
});

test("removing a market clears its session baseline so a re-save is fresh", () => {
  const localStorage = new Store();
  const sessionStorage = new Store();
  const added = addSavedMarket(emptySavedMarketScope(), scope, row({ reference: 100, completedHour: NOW - 2 * HOUR }), { now: NOW - HOUR });
  writeSavedMarketScope(localStorage, scope, added.value);
  const first = reconcileSavedMarkets({ localStorage, sessionStorage, scope, radar: radar([row({ reference: 120 })]), now: NOW });
  const entry = added.value.saved[0];
  assert.ok(first.baseline[savedMarketId(entry)]);
  assert.equal(clearSavedMarketVisitBaseline(sessionStorage, scope, entry).ok, true);
  const reSaved = addSavedMarket(emptySavedMarketScope(), scope, row({ reference: 130, completedHour: NOW }), { now: NOW });
  const comparison = savedMarketComparison({ saved: reSaved.value.saved[0], baseline: {}, radar: radar([row({ reference: 130, completedHour: NOW })]), scope, now: NOW });
  assert.equal(comparison.state, "new");
});
