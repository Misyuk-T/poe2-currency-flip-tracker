import test from "node:test";
import assert from "node:assert/strict";
import { buildCxapiFixtures } from "../src/data/fixtures/cxapi-fixtures.js";
import { normalizeCxDigest } from "../src/domain/cx-market.js";
import {
  buildCurrencyIndex,
  currencyIndexFromSnapshot,
  currencyIndexFromStoredSnapshot,
  currencySitemapUrls,
} from "../apps/web/lib/currency-summary.js";
import { RADAR_PAYLOAD_VERSION } from "../src/domain/radar-snapshot.js";

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
  const out = currencySitemapUrls(index, { popularIds: ["divine", "exalted"] });
  const byId = Object.fromEntries(out.map((e) => [e.id, e.lastModifiedMs]));

  assert.deepEqual(new Set(out.map((e) => e.id)), new Set(["divine", "exalted", "nameless", "undated"]));
  assert.equal(out.length, 4, "no duplicate urls");
  assert.equal(byId.divine, 1000, "data hour overrides the popular default");
  assert.equal(byId.exalted, null, "popular-without-data has no churning lastmod");
  assert.equal(byId.nameless, 2000);
  assert.equal(byId.undated, 2000, "missing per-currency hour falls back to index lastmod");
});

test("currencySitemapUrls degrades to popular-only (no lastmod) when there is no index", () => {
  const out = currencySitemapUrls(null, { popularIds: ["divine", "exalted"] });
  assert.deepEqual(out, [
    { id: "divine", lastModifiedMs: null },
    { id: "exalted", lastModifiedMs: null },
  ]);
});

test("currencyIndexFromSnapshot projects a precomputed snapshot into the index", () => {
  const index = currencyIndexFromSnapshot(
    {
      anchor: "exalted",
      rows: [
        {
          target: "chaos",
          reference: 47.75,
          referenceKind: "range-midpoint",
          low: 40,
          high: 55,
          rangePct: 0.3,
          movement: { h24: -3.5 },
          samples: 183,
          stale: false,
          latestCompletedHour: 1785200400000,
        },
      ],
    },
    { sourceMode: "official" },
  );
  assert.equal(index.anchor, "exalted");
  assert.equal(index.sourceMode, "official");
  assert.equal(index.byId.chaos.reference, 47.75);
  assert.equal(index.byId.chaos.samples, 183);
  assert.equal(index.byId.chaos.latestCompletedHourMs, 1785200400000);
  assert.equal(index.latestCompletedHour, new Date(1785200400000).toISOString());
});

test("stored currency indexes reject old or stale derived radar snapshots", () => {
  const now = Date.now();
  const payload = {
    payloadVersion: RADAR_PAYLOAD_VERSION,
    anchor: "exalted",
    rows: [{ target: "chaos", reference: 2, latestCompletedHour: now }],
  };
  assert.ok(currencyIndexFromStoredSnapshot({ payload, refreshedAt: now }));
  assert.equal(currencyIndexFromStoredSnapshot({ payload: { ...payload, payloadVersion: undefined }, refreshedAt: now }), null);
  assert.equal(currencyIndexFromStoredSnapshot({ payload, refreshedAt: now - 7 * 3600_000 }), null);
});

test("markets with no priced hour stay out of the index, and so out of the sitemap", () => {
  const index = currencyIndexFromSnapshot({
    anchor: "exalted",
    rows: [
      { target: "chaos", reference: 47.75, latestCompletedHour: 1785200400000 },
      { target: "never-traded", reference: null, samples: 0, latestCompletedHour: null },
    ],
  });
  assert.deepEqual(Object.keys(index.byId), ["chaos"]);
});

test("an empty or malformed snapshot yields null so the caller can fall back", () => {
  assert.equal(currencyIndexFromSnapshot(null), null);
  assert.equal(currencyIndexFromSnapshot({ anchor: "exalted", rows: [] }), null);
  assert.equal(currencyIndexFromSnapshot({ rows: [{ target: "chaos", reference: 1 }] }), null);
  assert.equal(currencyIndexFromSnapshot({ anchor: "exalted", rows: [{ target: "x", reference: null }] }), null);
});

test("a snapshot-backed index still drives the sitemap url set", () => {
  const index = currencyIndexFromSnapshot({
    anchor: "exalted",
    rows: [
      { target: "chaos", reference: 47.75, latestCompletedHour: 1785200400000 },
      { target: "fracturing-orb", reference: 3301, latestCompletedHour: 1785196800000 },
    ],
  });
  const urls = currencySitemapUrls(index, { popularIds: ["divine"] });
  assert.deepEqual(urls.map((u) => u.id).sort(), ["chaos", "divine", "fracturing-orb"]);
  assert.equal(urls.find((u) => u.id === "divine").lastModifiedMs, null);
  assert.equal(urls.find((u) => u.id === "chaos").lastModifiedMs, 1785200400000);
});
