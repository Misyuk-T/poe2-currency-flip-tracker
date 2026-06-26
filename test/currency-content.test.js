import test from "node:test";
import assert from "node:assert/strict";
import { currencyContent, contentFor } from "../apps/web/lib/currency-content.js";
import { popularCurrencies } from "../apps/web/lib/market.js";

test("every popular currency has hand-written, well-formed content", () => {
  for (const c of popularCurrencies) {
    const content = contentFor(c.id);
    assert.ok(content, `content for ${c.id} exists`);
    assert.ok(content.uses.length > 40, `${c.id} uses copy is substantial`);
    assert.ok(content.trading.length > 20, `${c.id} trading copy is substantial`);
    assert.ok(Array.isArray(content.faq) && content.faq.length >= 1, `${c.id} has FAQ`);
    for (const f of content.faq) {
      assert.ok(f.q && f.q.endsWith("?"), `${c.id} FAQ question is a question`);
      assert.ok(f.a && f.a.length > 20, `${c.id} FAQ answer is substantial`);
    }
  }
});

test("contentFor returns null for unknown currencies", () => {
  assert.equal(contentFor("totally-unknown-orb"), null);
});

test("currency copy is distinct (no copy-paste across currencies)", () => {
  const uses = Object.values(currencyContent).map((c) => c.uses);
  assert.equal(new Set(uses).size, uses.length, "every 'uses' blurb is unique");
  const trading = Object.values(currencyContent).map((c) => c.trading);
  assert.equal(new Set(trading).size, trading.length, "every 'trading' blurb is unique");
  const allFaqQ = Object.values(currencyContent).flatMap((c) => c.faq.map((f) => f.q));
  assert.equal(new Set(allFaqQ).size, allFaqQ.length, "every FAQ question is unique");
});

test("honesty guard: editorial copy invents no numeric figures", () => {
  // Live numbers belong to the data layer (clearly labelled). Static copy must
  // not contain prices/ratios/percentages. The game's own name is the only
  // allowed digit token.
  const SAFE = /PoE2|Path of Exile 2/g;
  const blobs = Object.values(currencyContent).flatMap((c) => [
    c.uses,
    c.trading,
    ...c.faq.flatMap((f) => [f.q, f.a]),
  ]);
  for (const text of blobs) {
    const cleaned = text.replace(SAFE, "");
    assert.ok(!/\d/.test(cleaned), `copy must not contain figures: "${text}"`);
  }
});
