import test from "node:test";
import assert from "node:assert/strict";

import {
  announcedLeague,
  buildFaqs,
  pickGuideLeague,
  plural,
  resolveGuideLeague,
} from "../apps/web/lib/league-start-guide.js";
import { MIN_COMPLETED_HOURS, MIN_PAIRS } from "../src/domain/league-default.js";

// The /guides/league-start-currency page is evergreen. Its league facts come
// from two places that must never be confused: the curated `announcedLeague`
// (official GGG sources, the only home of mechanics prose) and our own
// league_meta rows (what the exchange feed actually showed us). These guards
// cover both — the hand-edit failure modes (a renamed field leaving
// "undefined" in published copy, a start time drifting from its machine
// timestamp) and the three resolution cases the page renders.

const HOUR = 3_600_000;
const ANNOUNCED_START = Date.parse(announcedLeague.startsAtIso);
const NOW = ANNOUNCED_START + 200 * HOUR;

/** A league_meta row as the repository produces it. */
function metaRow(league, extra = {}) {
  return {
    league,
    firstSeenAt: NOW - 100 * HOUR,
    lastSeenAt: NOW,
    pairCount: 480,
    completedHours: 100,
    isPublic: true,
    isPermanent: false,
    isDefault: false,
    ...extra,
  };
}

const OLD_LEAGUE = metaRow("Runes of Aldur", { firstSeenAt: ANNOUNCED_START - 900 * HOUR });
const ANNOUNCED_ROW = metaRow(announcedLeague.name, { firstSeenAt: ANNOUNCED_START + HOUR });
// Depth that clears the shared bar (MIN_COMPLETED_HOURS / MIN_PAIRS): the guide
// names exactly the leagues chooseDefaultLeague would scope the site to.
const NEXT_LEAGUE = metaRow("Wraeclast Reborn", {
  firstSeenAt: NOW - 30 * HOUR,
  pairCount: 337,
  completedHours: 29,
});

const kindOf = (rows) => pickGuideLeague(rows, { now: NOW });
const coverage = (resolved) =>
  buildFaqs(resolved).find((f) => f.q === "Which league does this guide cover?").a;

test("no observed league newer than the announced one keeps the curated facts", () => {
  for (const rows of [[], null, [OLD_LEAGUE], [metaRow("Standard", { isPermanent: true, firstSeenAt: NOW })]]) {
    const resolved = kindOf(rows);
    assert.equal(resolved.kind, "announced");
    assert.equal(resolved.league, announcedLeague);
  }
  // A private league is noise, never the league this guide is about.
  assert.equal(kindOf([metaRow("Taras Test (PL12345)", { isPublic: false, firstSeenAt: NOW })]).kind, "announced");
  // Bad data dated in the future cannot win "newest" either.
  assert.equal(kindOf([metaRow("Clock Skew League", { firstSeenAt: NOW + 50 * HOUR })]).kind, "announced");
});

test("seeing the announced league on the exchange confirms it, adding a first priced hour", () => {
  const resolved = kindOf([OLD_LEAGUE, ANNOUNCED_ROW]);
  assert.equal(resolved.kind, "confirmed");
  assert.equal(resolved.league.name, announcedLeague.name);
  assert.equal(resolved.league.mechanics, announcedLeague.mechanics);
  assert.equal(resolved.league.firstSeenAt, new Date(ANNOUNCED_START + HOUR).toISOString());
  assert.match(resolved.league.firstSeenAtUtc, /^\d{1,2} \w+ \d{4}, \d{2}:\d{2} UTC$/);
  // Case and whitespace in the feed's league name must not split the two apart.
  assert.equal(kindOf([metaRow("  forbidden rites  ", { firstSeenAt: NOW })]).kind, "confirmed");
});

test("a newer, different league is reported as observed, with depth and no mechanics", () => {
  const resolved = kindOf([OLD_LEAGUE, ANNOUNCED_ROW, NEXT_LEAGUE]);
  assert.equal(resolved.kind, "observed");
  assert.deepEqual(Object.keys(resolved.league).sort(), [
    "completedHours",
    "firstSeenAt",
    "firstSeenAtUtc",
    "name",
    "pairCount",
  ]);
  assert.equal(resolved.league.name, "Wraeclast Reborn");
  assert.equal(resolved.league.pairCount, 337);
  assert.equal(resolved.league.completedHours, 29);
  assert.equal(resolved.league.firstSeenAt, new Date(NOW - 30 * HOUR).toISOString());
  // We know nothing about this league beyond what we priced: no mechanics, no
  // announced start, no source links leaking in from the curated facts.
  assert.equal(JSON.stringify(resolved.league).includes(announcedLeague.mechanics), false);
  for (const field of ["startsOn", "startsAt", "startsAtIso", "source", "endsWith", "mechanics"]) {
    assert.equal(field in resolved.league, false, `${field} must not be attached to an observed league`);
  }
});

test("the observed FAQ answer describes an observation, never a launch or a mechanic", () => {
  const answer = coverage(kindOf([ANNOUNCED_ROW, NEXT_LEAGUE]));
  assert.match(answer, /Wraeclast Reborn/);
  assert.match(answer, /seen on the exchange/);
  assert.doesNotMatch(answer, /launched|launches on|begins at/);
  // The mechanics of the announced league say nothing about the observed one.
  assert.equal(answer.includes(announcedLeague.mechanics), false);
  for (const word of ["Ritual", "Wildwood", "Sacred Bloom", "Trial of Chaos"]) {
    assert.equal(answer.includes(word), false, `observed copy must not claim ${word}`);
  }
  // It still says, honestly, which league the detailed notes below cover.
  assert.match(answer, new RegExp(announcedLeague.name));
});

test("the confirmed and announced FAQ answers keep the curated facts", () => {
  const announced = coverage({ kind: "announced", league: announcedLeague });
  assert.match(announced, new RegExp(`${announcedLeague.name} \\(${announcedLeague.version}\\)`));
  assert.match(announced, new RegExp(announcedLeague.startsOn));

  const confirmed = coverage(kindOf([ANNOUNCED_ROW]));
  assert.match(confirmed, new RegExp(announcedLeague.startsOn));
  assert.match(confirmed, /first saw .* priced on the exchange/);
});

test("every FAQ answer is publishable prose in all three kinds, with no leaked template holes", () => {
  const cases = [
    kindOf([]),
    kindOf([ANNOUNCED_ROW]),
    kindOf([ANNOUNCED_ROW, NEXT_LEAGUE]),
  ];
  assert.deepEqual(cases.map((c) => c.kind), ["announced", "confirmed", "observed"]);
  for (const resolved of cases) {
    const faqs = buildFaqs(resolved);
    assert.ok(faqs.length > 0, "the guide should ship at least one FAQ");
    for (const { q, a } of faqs) {
      assert.equal(typeof q, "string");
      assert.equal(typeof a, "string");
      assert.ok(q.trim().length > 0, `question is empty: ${JSON.stringify(q)}`);
      assert.ok(a.trim().length > 0, `answer for ${q} is empty`);
      // A renamed/removed field interpolates as the literal "undefined" (or
      // "null") rather than throwing, so assert it never ships.
      assert.doesNotMatch(a, /\bundefined\b|\bnull\b|\[object Object\]/, `answer for ${q} has a leaked template hole`);
    }
    const questions = faqs.map((f) => f.q);
    assert.equal(new Set(questions).size, questions.length, "FAQPage entries must not collide");
  }
});

test("the FAQPage JSON-LD serializes to valid JSON and round-trips, in all three kinds", () => {
  for (const resolved of [kindOf([]), kindOf([ANNOUNCED_ROW]), kindOf([ANNOUNCED_ROW, NEXT_LEAGUE])]) {
    const faqs = buildFaqs(resolved);
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
    assert.doesNotMatch(json, /\bundefined\b|\bnull\b/);
    const parsed = JSON.parse(json);
    assert.equal(parsed["@type"], "FAQPage");
    assert.equal(parsed.mainEntity.length, faqs.length);
    for (const entry of parsed.mainEntity) {
      assert.ok(entry.name && entry.acceptedAnswer.text);
    }
  }
});

test("resolveGuideLeague reads league_meta and falls back silently on any failure", async () => {
  const resolved = await resolveGuideLeague({
    now: NOW,
    readMeta: async (game) => {
      assert.equal(game, "poe2");
      return { rows: [ANNOUNCED_ROW, NEXT_LEAGUE] };
    },
  });
  assert.equal(resolved.kind, "observed");

  // No database / no table: readLeagueMetaCached answers with an empty row set.
  assert.equal((await resolveGuideLeague({ now: NOW, readMeta: async () => ({ rows: [] }) })).kind, "announced");

  // Anything unexpected is traced, never thrown: the page must still render.
  const traced = [];
  const broken = await resolveGuideLeague({
    now: NOW,
    readMeta: async () => { throw new Error("boom"); },
    trace: (phase, details) => traced.push({ phase, ...details }),
  });
  assert.equal(broken.kind, "announced");
  assert.equal(broken.league, announcedLeague);
  assert.deepEqual(traced.map((e) => e.phase), ["guide-league.resolve.error"]);
});

test("startsAtIso parses to the announced UTC instant", () => {
  const parsed = new Date(announcedLeague.startsAtIso);
  assert.ok(!Number.isNaN(parsed.getTime()), "startsAtIso should be a parseable timestamp");
  assert.equal(parsed.toISOString(), "2026-09-04T20:00:00.000Z");
  // GGG announced 1 PM PDT (UTC-7), i.e. 20:00 UTC — keep the machine-readable
  // timestamp and the human-readable strings from drifting apart.
  assert.equal(announcedLeague.startsAtUtc, "20:00 UTC");
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
    "mechanics",
  ]) {
    assert.equal(typeof announcedLeague[field], "string", `${field} should be a string`);
    assert.ok(announcedLeague[field].trim().length > 0, `${field} should not be empty`);
  }
});

test("every source link is an official pathofexile.com post", () => {
  for (const field of ["source", "pressSource", "faqSource"]) {
    const url = new URL(announcedLeague[field]);
    assert.equal(url.protocol, "https:");
    assert.equal(url.hostname, "www.pathofexile.com");
    assert.match(url.pathname, /^\/forum\/view-thread\/\d+$/, `${field} should point at a forum thread`);
  }
});

test("counts are pluralised, so a day-one league never reads \"1 markets\"", () => {
  assert.equal(plural(1, "market"), "1 market");
  assert.equal(plural(0, "market"), "0 markets");
  assert.equal(plural(337, "market"), "337 markets");
  assert.equal(plural(1, "completed hour"), "1 completed hour");
  assert.equal(plural(24, "completed hour"), "24 completed hours");

  // The prose itself must survive singular counts. They cannot arrive through
  // pickGuideLeague any more — the shared depth bar rejects a one-market league
  // outright — so the singular branch is exercised on the answer builder, which
  // is the thing under test here.
  const singular = coverage({
    kind: "observed",
    league: {
      name: "Wraeclast Reborn",
      firstSeenAt: new Date(NOW - 30 * HOUR).toISOString(),
      firstSeenAtUtc: "1 January 2026, 00:00 UTC",
      pairCount: 1,
      completedHours: 1,
    },
  });
  assert.match(singular, /with 1 market across 1 completed hour/);
  assert.doesNotMatch(singular, /\b1 markets\b|\b1 completed hours\b/);
});

test("the guide names exactly what the default-league rule would scope the site to", () => {
  // One bar, imported, not re-declared: the guide must never spend a league's
  // first day refusing to name the league every other page is already on.
  const thin = metaRow("Wraeclast Reborn", { firstSeenAt: NOW - 30 * HOUR });
  const at = (extra) => kindOf([ANNOUNCED_ROW, { ...thin, ...extra }]).kind;

  assert.equal(at({ completedHours: MIN_COMPLETED_HOURS - 1, pairCount: MIN_PAIRS }), "announced");
  assert.equal(at({ completedHours: MIN_COMPLETED_HOURS, pairCount: MIN_PAIRS }), "observed");
  // Hours alone were the old bar; a league nobody trades must not be named
  // either, exactly as chooseDefaultLeague refuses to scope the site to it.
  assert.equal(at({ completedHours: 168, pairCount: MIN_PAIRS - 1 }), "announced");
  assert.equal(at({ completedHours: 168, pairCount: MIN_PAIRS }), "observed");
});

test("a first-seen hour clamped to the aggregate window is not published", () => {
  // Reseed hazard: refreshLeagueMeta aggregates a 7-day window, so a cold
  // league_meta table records first_seen_at at the window floor. A long-running
  // old league would otherwise look brand new and outrank the announcement.
  const windowFloor = NOW - 7 * 24 * HOUR;
  const reseeded = metaRow("Runes of Aldur", { firstSeenAt: windowFloor, completedHours: 168 });
  assert.equal(kindOf([reseeded]).kind, "announced");
  // Within the tolerance band either way, because the floor is "now"-relative.
  assert.equal(kindOf([{ ...reseeded, firstSeenAt: windowFloor + HOUR }]).kind, "announced");
  assert.equal(kindOf([{ ...reseeded, firstSeenAt: windowFloor - HOUR }]).kind, "announced");
  // A genuine first-seen hour drifts away from the moving floor and is fine.
  assert.equal(kindOf([{ ...reseeded, firstSeenAt: windowFloor + 6 * HOUR, league: "Wraeclast Reborn" }]).kind, "observed");
});

test("a hardcore/SSF variant is never the league the guide names", () => {
  for (const name of ["Forbidden Rites HC", "Forbidden Rites SSF", "Forbidden Rites Hardcore", "HC Wraeclast Reborn"]) {
    const rows = [ANNOUNCED_ROW, metaRow(name, { firstSeenAt: NOW - 30 * HOUR, completedHours: 29 })];
    const resolved = kindOf(rows);
    assert.equal(resolved.kind, "confirmed", name);
    assert.equal(resolved.league.name, announcedLeague.name);
  }
});

test("the announced mechanics prose lives on announcedLeague alone", () => {
  // The page renders it only under the "Previously announced: <name>
  // (<version>)" heading once a newer league is trading; nothing the resolver
  // returns for that newer league may carry it.
  for (const word of ["Ritual", "Wildwood", "Sacred Bloom", "Trial of Chaos"]) {
    assert.ok(announcedLeague.mechanics.includes(word), `announced mechanics should mention ${word}`);
  }
  const observed = kindOf([ANNOUNCED_ROW, NEXT_LEAGUE]);
  const rendered = JSON.stringify(observed.league) + buildFaqs(observed).map((f) => f.a).join(" ");
  for (const word of ["Ritual", "Wildwood", "Sacred Bloom", "Trial of Chaos"]) {
    assert.equal(rendered.includes(word), false, `observed copy must not claim ${word}`);
  }
});
