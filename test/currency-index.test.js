import test from "node:test";
import assert from "node:assert/strict";
import { buildCxapiFixtures } from "../src/data/fixtures/cxapi-fixtures.js";
import { normalizeCxDigest } from "../src/domain/cx-market.js";
import { buildCurrencyIndex, currencySitemapUrls } from "../apps/web/lib/currency-summary.js";

function fixtureCandles() {
  const all = {};
  for (const d of buildCxapiFixtures({ league: "L" })) {
    for (const c of normalizeCxDigest(d.payload, { digestId: d.digestId, league: "L" }).candles) {
      (all[c.pairId] ??= []).push(c);
    }
  }
  return all;
}

test("buildCurrencyIndex shapes a slim per-target price/move index", () => {
  const all = fixtureCandles();
  const latest = Math.max(...Object.values(all).flat().map((c) => c.completedHour));
  const index = buildCurrencyIndex(all, { anchor: "exalted", sourceMode: "fixture", now: latest + 3600_000 });

  assert.equal(index.anchor, "exalted");
  assert.equal(index.sourceMode, "fixture");

  const divine = index.byId.divine;
  assert.ok(divine, "divine present in index");
  assert.ok(Number.isFinite(divine.reference), "reference is a number");
  assert.ok(Number.isFinite(divine.movement.h24), "24h movement present");
  assert.equal(typeof divine.latestCompletedHour, "string");
  assert.ok(Number.isFinite(divine.latestCompletedHourMs));

  // The anchor itself is never a target row (no price-vs-itself).
  assert.equal(index.byId.exalted, undefined);

  // Index-level lastmod is the newest completed hour across all targets.
  assert.ok(index.latestCompletedHourMs >= divine.latestCompletedHourMs);
});

test("buildCurrencyIndex returns serializable plain objects (no Map)", () => {
  const all = fixtureCandles();
  const index = buildCurrencyIndex(all, { anchor: "exalted" });
  // Round-trips through JSON unchanged → safe to hand to a server component / sitemap.
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(index)));
  assert.equal(index.sourceMode, "fixture"); // default
});

test("buildCurrencyIndex with no candles yields an empty index", () => {
  const index = buildCurrencyIndex({}, { anchor: "exalted", sourceMode: "official" });
  assert.deepEqual(index.byId, {});
  assert.equal(index.latestCompletedHour, null);
  assert.equal(index.latestCompletedHourMs, null);
  assert.equal(index.sourceMode, "official");
});

test("currencySitemapUrls unions popular + data-backed, deduped, with per-currency lastmod", () => {
  const index = {
    byId: {
      divine: { latestCompletedHourMs: 1000 }, // popular AND has data → data lastmod wins
      nameless: { latestCompletedHourMs: 2000 }, // data-backed, not popular → included
      undated: {}, // data-backed but no hour → falls back to index lastmod
    },
    latestCompletedHourMs: 2000,
  };
  const out = currencySitemapUrls(index, { popularIds: ["divine", "exalted"], nowMs: 9999 });
  const byId = Object.fromEntries(out.map((e) => [e.id, e.lastModifiedMs]));

  assert.deepEqual(new Set(out.map((e) => e.id)), new Set(["divine", "exalted", "nameless", "undated"]));
  assert.equal(out.length, 4, "no duplicate urls");
  assert.equal(byId.divine, 1000, "data hour overrides the popular default");
  assert.equal(byId.exalted, 9999, "popular-without-data uses now");
  assert.equal(byId.nameless, 2000);
  assert.equal(byId.undated, 2000, "missing per-currency hour falls back to index lastmod");
});

test("currencySitemapUrls degrades to popular-only when there is no index", () => {
  const out = currencySitemapUrls(null, { popularIds: ["divine", "exalted"], nowMs: 4242 });
  assert.deepEqual(out, [
    { id: "divine", lastModifiedMs: 4242 },
    { id: "exalted", lastModifiedMs: 4242 },
  ]);
});
