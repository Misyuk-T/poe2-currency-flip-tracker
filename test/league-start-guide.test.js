import test from "node:test";
import assert from "node:assert/strict";

import { currentLeague, faqs } from "../apps/web/lib/league-start-guide.js";

// The /guides/league-start-currency page is evergreen: its league facts get
// hand-edited every league. These guards catch the ways that edit goes wrong —
// a renamed field leaving `undefined` interpolated into published copy, or a
// start time that no longer matches its machine-readable timestamp.

test("every FAQ answer is publishable prose, with no leaked template holes", () => {
  assert.ok(faqs.length > 0, "the guide should ship at least one FAQ");
  for (const { q, a } of faqs) {
    assert.equal(typeof q, "string");
    assert.equal(typeof a, "string");
    assert.ok(q.trim().length > 0, `question is empty: ${JSON.stringify(q)}`);
    assert.ok(a.trim().length > 0, `answer for ${q} is empty`);
    // A renamed/removed currentLeague field interpolates as the literal
    // "undefined" (or "null") rather than throwing, so assert it never ships.
    assert.doesNotMatch(a, /\bundefined\b|\bnull\b|\[object Object\]/, `answer for ${q} has a leaked template hole`);
  }
});

test("FAQ questions are unique, so the FAQPage entries do not collide", () => {
  const questions = faqs.map((f) => f.q);
  assert.equal(new Set(questions).size, questions.length);
});

test("the FAQPage JSON-LD serializes to valid JSON and round-trips", () => {
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
  const json = JSON.stringify(faqLd);
  // The page injects this raw into a <script> tag, so a literal "</script>"
  // in any answer would break out of it.
  assert.doesNotMatch(json, /<\/script/i);
  const parsed = JSON.parse(json);
  assert.equal(parsed["@type"], "FAQPage");
  assert.equal(parsed.mainEntity.length, faqs.length);
  for (const entry of parsed.mainEntity) {
    assert.ok(entry.name && entry.acceptedAnswer.text);
  }
});

test("startsAtIso parses to the announced UTC instant", () => {
  const parsed = new Date(currentLeague.startsAtIso);
  assert.ok(!Number.isNaN(parsed.getTime()), "startsAtIso should be a parseable timestamp");
  assert.equal(parsed.toISOString(), "2026-09-04T20:00:00.000Z");
  // GGG announced 1 PM PDT (UTC-7), i.e. 20:00 UTC — keep the machine-readable
  // timestamp and the human-readable strings from drifting apart.
  assert.equal(currentLeague.startsAtUtc, "20:00 UTC");
  assert.equal(parsed.getUTCHours(), 20);
});

test("the league facts the copy interpolates are all present and non-empty", () => {
  for (const field of [
    "name",
    "version",
    "startsOn",
    "startsAt",
    "startsAtUtc",
    "startsAtIso",
    "endsWith",
    "parallelLeague",
  ]) {
    assert.equal(typeof currentLeague[field], "string", `${field} should be a string`);
    assert.ok(currentLeague[field].trim().length > 0, `${field} should not be empty`);
  }
});

test("every source link is an official pathofexile.com post", () => {
  for (const field of ["source", "pressSource", "faqSource"]) {
    const url = new URL(currentLeague[field]);
    assert.equal(url.protocol, "https:");
    assert.equal(url.hostname, "www.pathofexile.com");
    assert.match(url.pathname, /^\/forum\/view-thread\/\d+$/, `${field} should point at a forum thread`);
  }
});
