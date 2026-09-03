import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyCurrencyPage,
  currencyPagePath,
  currencyPageRobots,
  isUsableCurrencySlug,
  shouldIndexCurrencyPage,
} from "../apps/web/lib/currency-indexability.js";
import { currencyPageMetadata } from "../apps/web/lib/currency-page-metadata.js";
import { currencySitemapUrls, currencyIndexFromSnapshot } from "../apps/web/lib/currency-summary.js";

// The eight live ids the identity build has no short id for. Their pages answer
// 200 at the percent-encoded form and 404 at the form the site used to emit.
const UNROUTABLE = "Metadata/Items/SoulCores/IdolPanther";

test("an id that is not a single URL path segment is not indexable", () => {
  assert.equal(isUsableCurrencySlug(UNROUTABLE), false);
  assert.deepEqual(classifyCurrencyPage({ id: UNROUTABLE }), { index: false, reason: "unusable-slug" });
  assert.equal(isUsableCurrencySlug("mórrigans-insight"), true, "accents are fine — this is about URL shape");
  assert.equal(isUsableCurrencySlug("a b"), false, "whitespace cannot address the route either");
  assert.equal(isUsableCurrencySlug(""), false);
  assert.equal(isUsableCurrencySlug(undefined), false);
});

test("a sparse market is INDEXABLE — the audit rejected a depth threshold", () => {
  // A market that has printed one price, or none at all, is most likely a NEW
  // listing: exactly the `<item> price` long tail that earns this site clicks,
  // and with no internal links to reach it the sitemap is its only discovery
  // path. Nothing about market activity may hide a page.
  for (const id of ["temporalis", "the-arbiters-reliquary-key", "aldurs-saga", "perfect-flux"]) {
    assert.deepEqual(classifyCurrencyPage({ id }), { index: true, reason: "indexable" }, id);
    assert.equal(currencyPageRobots({ id }), undefined, `${id} must not carry a robots tag`);
  }
});

test("the classification depends on the id alone, never on market data", () => {
  // Guards the regression the review caught: `samples` anchors on a market's own
  // latest priced hour, so it scores a dead market healthy and a new one thin.
  // No caller may reintroduce it by passing extra fields.
  const bare = classifyCurrencyPage({ id: "stone-rune" });
  for (const extra of [{ samples: 0 }, { samples: 1 }, { pricedHours: 0 }, { stale: true }]) {
    assert.deepEqual(classifyCurrencyPage({ id: "stone-rune", ...extra }), bare, JSON.stringify(extra));
  }
});

test("hand-written editorial copy is reported, and keeps the popular pages listed", () => {
  // This is the reason the six popular pages survive the degraded, no-database
  // sitemap path, so it is worth naming rather than folding into "indexable".
  assert.equal(classifyCurrencyPage({ id: "divine" }).reason, "editorial-content");
  assert.equal(shouldIndexCurrencyPage({ id: "exalted" }), true, "the anchor has no summary of its own");
});

test("currencyPagePath resolves: verbatim for routable ids, encoded otherwise", () => {
  // Verified against a production build: /poe2/currencies/Metadata/Items/... is
  // a 404 (four segments, one-segment route) while the encoded form returns 200.
  assert.equal(currencyPagePath("divine"), "/poe2/currencies/divine");
  assert.equal(currencyPagePath("mórrigans-insight"), "/poe2/currencies/mórrigans-insight");
  assert.equal(currencyPagePath(UNROUTABLE), "/poe2/currencies/Metadata%2FItems%2FSoulCores%2FIdolPanther");
  assert.equal(currencyPagePath(UNROUTABLE).split("/").length, 4, "collapses to one path segment");
});

test("an unroutable page no longer advertises a canonical that 404s", () => {
  const meta = currencyPageMetadata({ id: UNROUTABLE });
  assert.equal(meta.alternates.canonical.endsWith("/poe2/currencies/Metadata%2FItems%2FSoulCores%2FIdolPanther"), true);
  assert.doesNotMatch(meta.alternates.canonical, /currencies\/Metadata\/Items/, "must not point at the 404 form");
  assert.deepEqual(meta.robots, { index: false, follow: true });
});

test("a routable page's metadata is untouched — no robots key, canonical verbatim", () => {
  const meta = currencyPageMetadata({ id: "greater-essence-of-battle" });
  assert.equal(meta.robots, undefined, "`undefined` leaves the site-wide indexable default alone");
  assert.equal(meta.title, "Greater Essence of Battle Price — PoE2 Hourly Market Data");
  assert.match(meta.description, /^Hourly Greater Essence of Battle price, range and 24h move/);
  assert.equal(meta.alternates.canonical.endsWith("/poe2/currencies/greater-essence-of-battle"), true);
});

test("the sitemap drops unroutable ids and keeps everything else — one rule, two call sites", () => {
  const index = currencyIndexFromSnapshot({
    anchor: "exalted",
    rows: [
      { target: "chaos", reference: 47.75, samples: 25, latestCompletedHour: 1785200400000 },
      // A brand-new listing with a single priced hour: stays listed.
      { target: "the-arbiters-reliquary-key", reference: 0.5, samples: 1, latestCompletedHour: 1785196800000 },
      // A busy market whose emitted URL 404s: dropped.
      { target: UNROUTABLE, reference: 12, samples: 25, latestCompletedHour: 1785196800000 },
    ],
  });

  const urls = currencySitemapUrls(index, { popularIds: ["divine"] });
  assert.deepEqual(urls.map((u) => u.id).sort(), ["chaos", "divine", "the-arbiters-reliquary-key"]);
  // The surviving entries keep their per-currency lastmod semantics.
  assert.equal(urls.find((u) => u.id === "chaos").lastModifiedMs, 1785200400000);
  assert.equal(urls.find((u) => u.id === "divine").lastModifiedMs, null);
  assert.equal(urls.some((u) => /[/\s]/.test(u.id)), false, "no emitted id can break the path");
});

test("the degraded, no-index sitemap path still lists the popular pages", () => {
  assert.deepEqual(currencySitemapUrls(null, { popularIds: ["divine", "exalted"] }), [
    { id: "divine", lastModifiedMs: null },
    { id: "exalted", lastModifiedMs: null },
  ]);
});
