import test from "node:test";
import assert from "node:assert/strict";
import { leagueDay, selectPoe1LeagueMeta } from "../apps/web/lib/league-meta.js";

const NOW = Date.parse("2026-08-03T12:00:00Z");
const entries = [
  {
    id: "Standard",
    realm: "pc",
    startAt: "2013-01-23T21:00:00Z",
    endAt: null,
    category: { id: "Standard" },
  },
  {
    id: "Ruthless Allflame",
    realm: "pc",
    startAt: "2026-07-24T20:00:00Z",
    endAt: null,
    category: { id: "Allflame", current: true },
  },
];

test("selects the current PoE 1 challenge league and computes its real day", () => {
  assert.deepEqual(selectPoe1LeagueMeta(entries, "Ruthless Allflame", NOW), {
    available: true,
    league: "Ruthless Allflame",
    kind: "challenge",
    current: true,
    startAt: "2026-07-24T20:00:00Z",
    endAt: null,
    dayNumber: 10,
    daysRemaining: null,
    source: "ggg-legacy",
  });
});
test("marks permanent PoE 1 leagues without inventing an end date", () => {
  assert.deepEqual(selectPoe1LeagueMeta(entries, "Standard", NOW), {
    available: true,
    league: "Standard",
    kind: "permanent",
    source: "ggg-legacy",
  });
});

test("rejects missing, non-PC, old, malformed, and future challenge records", () => {
  assert.deepEqual(selectPoe1LeagueMeta(entries, "Allflame", NOW), { available: false });
  assert.deepEqual(selectPoe1LeagueMeta([{ ...entries[1], realm: "poe2" }], "Ruthless Allflame", NOW), { available: false });
  assert.deepEqual(selectPoe1LeagueMeta([{ ...entries[1], category: { id: "Allflame" } }], "Ruthless Allflame", NOW), { available: false });
  assert.deepEqual(selectPoe1LeagueMeta([{ ...entries[1], startAt: "not-a-date" }], "Ruthless Allflame", NOW), { available: false });
  assert.equal(leagueDay("2026-08-04T00:00:00Z", NOW), null);
});
