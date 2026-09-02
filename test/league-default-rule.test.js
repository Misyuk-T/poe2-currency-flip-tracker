import test from "node:test";
import assert from "node:assert/strict";

import {
  chooseDefaultLeague,
  isPermanentLeague,
  PERMANENT_LEAGUE_PREFIXES,
  PERMANENT_LEAGUE_SUFFIXES,
} from "../src/domain/league-default.js";

const HOUR = 3600_000;
const NOW = Date.parse("2026-09-06T12:00:00Z");

/** A league_meta row with sane defaults; override what a case is about. */
function row(league, { hoursAgo = 0, completedHours = 0, pairCount = 0, ...rest } = {}) {
  return {
    league,
    firstSeenAt: NOW - hoursAgo * HOUR,
    lastSeenAt: NOW,
    completedHours,
    pairCount,
    isPublic: true,
    isPermanent: isPermanentLeague(league, "poe2"),
    isDefault: false,
    ...rest,
  };
}

// The live economy on the day Forbidden Rites launches: a deep incumbent, a
// hours-old newcomer, and the permanent leagues that always exist.
const RUNES = row("Runes of Aldur", { hoursAgo: 40 * 24, completedHours: 168, pairCount: 640 });
const STANDARD = row("Standard", { hoursAgo: 400 * 24, completedHours: 168, pairCount: 900 });
const HARDCORE = row("HC Runes of Aldur", { hoursAgo: 40 * 24, completedHours: 168, pairCount: 300 });

test("permanent leagues and their HC/SSF variants are never eligible", () => {
  for (const name of ["Standard", "Hardcore", "Ruthless", "Hardcore Ruthless"]) {
    assert.equal(isPermanentLeague(name, "poe2"), true, name);
  }
  for (const prefix of PERMANENT_LEAGUE_PREFIXES) {
    assert.equal(isPermanentLeague(`${prefix}Forbidden Rites`, "poe2"), true, prefix);
  }
  for (const suffix of PERMANENT_LEAGUE_SUFFIXES) {
    assert.equal(isPermanentLeague(`Forbidden Rites${suffix}`, "poe2"), true, suffix);
  }
  // The two games spell the Ruthless variant differently; both are excluded.
  assert.equal(isPermanentLeague("Ruthless Allflame", "poe1"), true);
  assert.equal(isPermanentLeague("Runes of Aldur Ruthless", "poe2"), true);
  assert.equal(isPermanentLeague("Forbidden Rites", "poe2"), false);
  assert.equal(isPermanentLeague("Allflame", "poe1"), false);
  assert.equal(isPermanentLeague("", "poe2"), false);
  assert.equal(isPermanentLeague(null), false);

  // Even with more depth than every challenge league, Standard cannot win.
  assert.equal(
    chooseDefaultLeague([STANDARD, HARDCORE, RUNES], {
      game: "poe2",
      currentDefault: "Runes of Aldur",
      now: NOW,
    }),
    "Runes of Aldur",
  );
});

test("a day-one league does not take the default: too few completed hours", () => {
  // The exact production scenario: Forbidden Rites launched ~20h ago, priced
  // widely already, but nowhere near 48 completed hours.
  const forbidden = row("Forbidden Rites", { hoursAgo: 20, completedHours: 20, pairCount: 480 });
  assert.equal(
    chooseDefaultLeague([forbidden, RUNES, STANDARD, HARDCORE], {
      game: "poe2",
      currentDefault: "Runes of Aldur",
      now: NOW,
    }),
    "Runes of Aldur",
  );
});

test("a thin league does not take the default even after 48 hours: too few pairs", () => {
  const thin = row("Forbidden Rites", { hoursAgo: 72, completedHours: 72, pairCount: 199 });
  assert.equal(
    chooseDefaultLeague([thin, RUNES], { game: "poe2", currentDefault: "Runes of Aldur", now: NOW }),
    "Runes of Aldur",
  );
});

test("a league with real depth flips the default forward", () => {
  const forbidden = row("Forbidden Rites", { hoursAgo: 72, completedHours: 60, pairCount: 520 });
  assert.equal(
    chooseDefaultLeague([forbidden, RUNES, STANDARD, HARDCORE], {
      game: "poe2",
      currentDefault: "Runes of Aldur",
      now: NOW,
    }),
    "Forbidden Rites",
  );
});

test("the default only ever moves forward: an older league can never take it back", () => {
  const older = row("Runes of Aldur", { hoursAgo: 90 * 24, completedHours: 168, pairCount: 900 });
  const current = row("Forbidden Rites", { hoursAgo: 10 * 24, completedHours: 168, pairCount: 520 });
  assert.equal(
    chooseDefaultLeague([older, current], { game: "poe2", currentDefault: "Forbidden Rites", now: NOW }),
    "Forbidden Rites",
  );
});

test("empty, unusable or all-permanent input keeps the current default", () => {
  const opts = { game: "poe2", currentDefault: "Runes of Aldur", now: NOW };
  assert.equal(chooseDefaultLeague([], opts), "Runes of Aldur");
  assert.equal(chooseDefaultLeague(null, opts), "Runes of Aldur");
  assert.equal(chooseDefaultLeague([STANDARD, HARDCORE], opts), "Runes of Aldur");
  // Private leagues are excluded even when the stored flag says otherwise.
  const private_ = row("Forbidden Rites (PL12345)", {
    hoursAgo: 200,
    completedHours: 168,
    pairCount: 900,
    isPublic: false,
  });
  assert.equal(chooseDefaultLeague([private_], opts), "Runes of Aldur");
});

test("a firstSeenAt in the future is bad data and cannot hijack the default", () => {
  const skewed = row("Bogus League", { hoursAgo: -48, completedHours: 168, pairCount: 900 });
  assert.equal(
    chooseDefaultLeague([skewed, RUNES], { game: "poe2", currentDefault: "Runes of Aldur", now: NOW }),
    "Runes of Aldur",
  );
});

test("with no known current default, the newest qualifying league wins deterministically", () => {
  const a = row("Alpha League", { hoursAgo: 100, completedHours: 100, pairCount: 300 });
  const b = row("Beta League", { hoursAgo: 100, completedHours: 100, pairCount: 300 });
  const newer = row("Gamma League", { hoursAgo: 99, completedHours: 99, pairCount: 300 });
  assert.equal(chooseDefaultLeague([a, b, newer], { game: "poe2", now: NOW }), "Gamma League");
  // Tie on firstSeenAt breaks on name, so the answer never depends on row order.
  assert.equal(chooseDefaultLeague([b, a], { game: "poe2", now: NOW }), "Alpha League");
  assert.equal(chooseDefaultLeague([a, b], { game: "poe2", now: NOW }), "Alpha League");
});

test("PoE 1's first run moves off permanent Standard onto the live challenge league", () => {
  // PoE 1 starts from the code fallback "Standard", which is permanent and so
  // can never qualify. That leaves currentDefault with no firstSeenAt to walk
  // forward from, and the newest eligible league wins — which is the intent:
  // PoE 1 should land on the current challenge league, not on Standard.
  const rows = [
    row("Standard", { hoursAgo: 400 * 24, completedHours: 168, pairCount: 900 }),
    row("Hardcore", { hoursAgo: 400 * 24, completedHours: 168, pairCount: 400 }),
    row("Ruthless Allflame", { hoursAgo: 30 * 24, completedHours: 168, pairCount: 260 }),
    row("Allflame", { hoursAgo: 30 * 24, completedHours: 168, pairCount: 700 }),
  ].map((entry) => ({ ...entry, isPermanent: isPermanentLeague(entry.league, "poe1") }));

  assert.equal(
    chooseDefaultLeague(rows, { game: "poe1", currentDefault: "Standard", now: NOW }),
    "Allflame",
  );

  // Determinism matters here because retention pruning clamps every long-lived
  // league's window-min to the same hour: two eligible leagues routinely tie on
  // firstSeenAt, and the answer must not depend on row order.
  const tied = [
    row("Necropolis", { hoursAgo: 7 * 24, completedHours: 168, pairCount: 700 }),
    row("Allflame", { hoursAgo: 7 * 24, completedHours: 168, pairCount: 700 }),
  ];
  assert.equal(chooseDefaultLeague(tied, { game: "poe1", currentDefault: "Standard", now: NOW }), "Allflame");
  assert.equal(
    chooseDefaultLeague(tied.slice().reverse(), { game: "poe1", currentDefault: "Standard", now: NOW }),
    "Allflame",
  );
});

test("thresholds are configurable and applied as inclusive minimums", () => {
  const rows = [row("Forbidden Rites", { hoursAgo: 24, completedHours: 24, pairCount: 200 })];
  const base = { game: "poe2", currentDefault: "Runes of Aldur", now: NOW };
  assert.equal(chooseDefaultLeague(rows, base), "Runes of Aldur");
  assert.equal(chooseDefaultLeague(rows, { ...base, minCompletedHours: 24, minPairs: 200 }), "Forbidden Rites");
  assert.equal(chooseDefaultLeague(rows, { ...base, minCompletedHours: 24, minPairs: 201 }), "Runes of Aldur");
});
