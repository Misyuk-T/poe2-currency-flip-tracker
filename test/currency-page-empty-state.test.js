import test from "node:test";
import assert from "node:assert/strict";

// The no-database case is one of the two things under test, so make sure there
// is none regardless of the developer's shell.
delete process.env.DATABASE_URL;

import { getCurrencyPageData, getCurrencySummary } from "../apps/web/lib/currency-summary.js";
import { loadConfig } from "../src/server/config.js";

/**
 * The currency page publishes "Not traded in <league> yet" from `empty`. That
 * sentence is a claim about the MARKET, so it must never be produced by a
 * situation that is a fact about US. Both cases below return no summary, and
 * both must return no `empty` either.
 */
test("the anchor currency is never reported as untraded", () => {
  const anchor = loadConfig().anchorCurrency;
  assert.ok(anchor, "the config must name an anchor for this test to mean anything");
  return getCurrencyPageData(anchor).then((page) => {
    assert.equal(page.summary, null);
    assert.equal(page.empty, null, "the currency every price is quoted in has no 'untraded' state");
  });
});

test("no database is not evidence that a market has not traded", async () => {
  const page = await getCurrencyPageData("divine");
  assert.equal(page.summary, null);
  assert.equal(page.empty, null);
});

test("getCurrencySummary still returns the summary alone", async () => {
  assert.equal(await getCurrencySummary("divine"), null);
});
