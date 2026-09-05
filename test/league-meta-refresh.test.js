import test from "node:test";
import assert from "node:assert/strict";

// No DATABASE_URL: the resolver must never depend on one existing, and the
// repository under test here is the in-memory twin.
delete process.env.DATABASE_URL;
delete process.env.LEAGUE;
delete process.env.POE1_LEAGUE;

import { createRadarRepository } from "../src/storage/radar-repository.js";
import { chooseDefaultLeague } from "../src/domain/league-default.js";
import { createMemoryRepository } from "../apps/web/lib/memory-repo.js";
import {
  readLeagueMetaCached,
  resetLeagueMetaCache,
  resolveDefaultLeague,
} from "../apps/web/lib/default-league.js";
import { refreshLeagueDefaults } from "../apps/web/lib/radar-backend.js";

const HOUR = 3600_000;
const NOW = Date.parse("2026-09-06T12:00:00Z");
const SCOPE = { game: "poe2", realm: "poe2", league: "Runes of Aldur", mode: "live" };

const CONFIG = {
  poeGame: "poe2",
  poeRealm: "poe2",
  league: "Runes of Aldur",
  leagues: ["Runes of Aldur"],
  poe1League: "Standard",
  poe1Leagues: ["Standard"],
  anchorCurrency: "exalted",
  anchors: ["exalted"],
  shortlist: [],
  providerMode: "live",
  radarMaxHotTargets: 8,
  cxapiStreams: [{ game: "poe2", realm: "poe2" }],
};

/** `pairs` markets priced over the `hours` completed hours ending at NOW. */
function digest(league, { pairs, hours, endsAt = NOW }) {
  const candles = [];
  for (let h = 0; h < hours; h += 1) {
    const completedHour = endsAt - h * HOUR;
    for (let p = 0; p < pairs; p += 1) {
      candles.push({
        league,
        completedHour,
        pairId: `exalted|c${p}`,
        base: "exalted",
        quote: `c${p}`,
        low: 1,
        high: 2,
        reference: 1.5,
        referenceKind: "range-midpoint-proxy",
        volume: {},
        source: "test",
      });
    }
  }
  return { digestId: endsAt / HOUR, nextChangeId: null, candles };
}

test("memory repo refreshLeagueMeta aggregates depth per league and never deletes rows", async () => {
  const repo = createMemoryRepository(SCOPE);
  await repo.recordCxDigest(digest("Runes of Aldur", { pairs: 3, hours: 4 }));
  await repo.recordCxDigest(digest("Standard", { pairs: 2, hours: 2 }));

  const rows = await repo.refreshLeagueMeta({ now: NOW });
  const runes = rows.find((r) => r.league === "Runes of Aldur");
  assert.equal(runes.pairCount, 3);
  assert.equal(runes.completedHours, 4);
  assert.equal(runes.firstSeenAt, NOW - 3 * HOUR);
  assert.equal(runes.lastSeenAt, NOW);
  assert.equal(runes.isPublic, true);
  assert.equal(runes.isPermanent, false);
  assert.equal(rows.find((r) => r.league === "Standard").isPermanent, true);

  // first_seen_at only ever moves BACKWARDS. A later refresh whose window no
  // longer reaches the oldest hour (retention pruning) must not make an old
  // league look newly born — that would break the forward-only hysteresis.
  await repo.recordCxDigest(digest("Runes of Aldur", { pairs: 3, hours: 1 }));
  const again = await repo.refreshLeagueMeta({ now: NOW });
  assert.equal(again.find((r) => r.league === "Runes of Aldur").firstSeenAt, NOW - 3 * HOUR);
});

test("setDefaultLeague persists exactly one default and survives a refresh", async () => {
  const repo = createMemoryRepository(SCOPE);
  await repo.recordCxDigest(digest("Runes of Aldur", { pairs: 2, hours: 2 }));
  await repo.recordCxDigest(digest("Forbidden Rites", { pairs: 2, hours: 2 }));
  await repo.refreshLeagueMeta({ now: NOW });

  await repo.setDefaultLeague("Runes of Aldur");
  let rows = await repo.readLeagueMeta();
  assert.deepEqual(rows.filter((r) => r.isDefault).map((r) => r.league), ["Runes of Aldur"]);

  await repo.setDefaultLeague("Forbidden Rites");
  rows = await repo.readLeagueMeta();
  assert.deepEqual(rows.filter((r) => r.isDefault).map((r) => r.league), ["Forbidden Rites"]);

  // A league with no candles still gets a row, so an env/code fallback can be
  // recorded as the default before it has ever been priced.
  await repo.setDefaultLeague("Brand New League");
  rows = await repo.refreshLeagueMeta({ now: NOW });
  assert.deepEqual(rows.filter((r) => r.isDefault).map((r) => r.league), ["Brand New League"]);
  assert.equal(rows.length, 3);
});

test("the aggregate keeps the incumbent at 7 completed hours and flips at 8", async () => {
  const repo = createMemoryRepository(SCOPE);
  // The real shape on 2026-09-04: a deep incumbent, a deep permanent league, and
  // Forbidden Rites one hour short of the gate.
  await repo.recordCxDigest(digest("Runes of Aldur", { pairs: 200, hours: 60 }));
  await repo.recordCxDigest(digest("Standard", { pairs: 200, hours: 60 }));
  await repo.recordCxDigest(digest("Forbidden Rites", { pairs: 200, hours: 7 }));

  const rows = await repo.refreshLeagueMeta({ now: NOW });
  assert.equal(rows.find((r) => r.league === "Forbidden Rites").completedHours, 7);
  assert.equal(
    chooseDefaultLeague(rows, { game: "poe2", currentDefault: "Runes of Aldur", now: NOW }),
    "Runes of Aldur",
  );

  // One more candle hour — 8 distinct hours — and it wins. Pinned exactly, so a
  // future change to the threshold cannot pass this test silently.
  const later = NOW + HOUR;
  await repo.recordCxDigest(digest("Forbidden Rites", { pairs: 200, hours: 1, endsAt: later }));
  const deeper = await repo.refreshLeagueMeta({ now: later });
  assert.equal(deeper.find((r) => r.league === "Forbidden Rites").completedHours, 8);
  assert.equal(
    chooseDefaultLeague(deeper, { game: "poe2", currentDefault: "Runes of Aldur", now: later }),
    "Forbidden Rites",
  );
});

test("the cron step refreshes metadata, persists the default, and never throws", async () => {
  const repos = new Map();
  const makeRepo = (scope) => {
    const key = `${scope.game}|${scope.realm}|${scope.mode}`;
    if (!repos.has(key)) repos.set(key, createMemoryRepository(scope));
    return repos.get(key);
  };
  const ctx = { config: CONFIG, scope: { ...SCOPE } };
  const seed = makeRepo({ ...SCOPE });
  await seed.recordCxDigest(digest("Runes of Aldur", { pairs: 200, hours: 60 }));
  // Below the depth threshold, so this test is about the cron's mechanics
  // (aggregate, decide, persist once) and not about the rule flipping.
  await seed.recordCxDigest(digest("Forbidden Rites", { pairs: 200, hours: 2 }));

  const traced = [];
  resetLeagueMetaCache();
  const results = await refreshLeagueDefaults(ctx, {
    now: NOW,
    makeRepo,
    trace: (phase, details) => traced.push({ phase, ...details }),
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].game, "poe2");
  assert.equal(results[0].defaultLeague, "Runes of Aldur");
  assert.equal(results[0].previousDefault, null);
  assert.equal(results[0].changed, true);
  assert.deepEqual(
    (await seed.readLeagueMeta()).filter((r) => r.isDefault).map((r) => r.league),
    ["Runes of Aldur"],
  );
  assert.deepEqual(
    traced.map((e) => e.phase),
    ["league-meta.scope.start", "league-meta.scope.end"],
  );

  // Second run: nothing moved, so nothing is written.
  const second = await refreshLeagueDefaults(ctx, { now: NOW, makeRepo });
  assert.equal(second[0].previousDefault, "Runes of Aldur");
  assert.equal(second[0].changed, false);
});

test("a failing league-meta refresh is traced and never fails the cron", async () => {
  const ctx = { config: CONFIG, scope: { ...SCOPE } };
  const traced = [];
  const results = await refreshLeagueDefaults(ctx, {
    now: NOW,
    trace: (phase, details) => traced.push({ phase, ...details }),
    makeRepo: () => ({
      refreshLeagueMeta: async () => {
        const error = new Error('relation "league_meta" does not exist');
        error.code = "42P01";
        throw error;
      },
    }),
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].errorCode, "42P01");
  assert.ok(traced.some((e) => e.phase === "league-meta.scope.error"));
});

test("with no database at all the cron step reports a skip, not an error", async () => {
  const results = await refreshLeagueDefaults(
    { config: CONFIG, scope: { ...SCOPE } },
    { now: NOW, makeRepo: () => null },
  );
  assert.deepEqual(results, [{ game: "poe2", skipped: "no-database" }]);
});

/** A stored league_meta row; `pairCount: 0` means "observed but unpriced". */
function metaRow(league, extra = {}) {
  return {
    league,
    firstSeenAt: NOW,
    lastSeenAt: NOW,
    pairCount: 500,
    completedHours: 168,
    isPublic: true,
    isPermanent: false,
    isDefault: false,
    ...extra,
  };
}
const repoWith = (...rows) => () => ({ readLeagueMeta: async () => rows });

test("resolver precedence: env override beats the database, which beats the fallback", async () => {
  // Both candidate leagues carry real depth, so the unpriced guard stays out of
  // the way and this test is about precedence alone.
  const makeRepo = repoWith(metaRow("Forbidden Rites", { isDefault: true }), metaRow("Pinned League"));

  resetLeagueMetaCache();
  assert.deepEqual(
    await resolveDefaultLeague("poe2", { config: CONFIG, makeRepo }),
    { league: "Forbidden Rites", source: "db" },
  );

  process.env.LEAGUE = "Pinned League";
  try {
    resetLeagueMetaCache();
    assert.deepEqual(
      await resolveDefaultLeague("poe2", { config: CONFIG, makeRepo }),
      { league: "Pinned League", source: "env" },
    );
    // A blank env var is not an override.
    process.env.LEAGUE = "   ";
    resetLeagueMetaCache();
    assert.equal((await resolveDefaultLeague("poe2", { config: CONFIG, makeRepo })).source, "db");
  } finally {
    delete process.env.LEAGUE;
  }

  resetLeagueMetaCache();
  assert.deepEqual(
    await resolveDefaultLeague("poe2", { config: CONFIG, makeRepo: repoWith() }),
    { league: "Runes of Aldur", source: "fallback" },
  );

  // No database (the local/dev case) is the fallback too, not an error.
  resetLeagueMetaCache();
  assert.deepEqual(
    await resolveDefaultLeague("poe1", { config: CONFIG, makeRepo: () => null }),
    { league: "Standard", source: "fallback" },
  );
});

test("a default with no priced candles is superseded by the best league that has them", async () => {
  const traced = [];
  const trace = (phase, details) => traced.push({ phase, ...details });
  // setDefaultLeague can record a league that has no candles at all (an env or
  // code fallback). /api/config already drops such a league; the resolver must
  // agree, or /api/radar would serve a different default than /api/config names.
  const makeRepo = repoWith(
    metaRow("Ghost League", { pairCount: 0, completedHours: 0, isDefault: true }),
    metaRow("Standard", { isPermanent: true }),
    metaRow("Runes of Aldur", { firstSeenAt: NOW - 500 * HOUR }),
    metaRow("Forbidden Rites", { firstSeenAt: NOW - 100 * HOUR }),
  );
  resetLeagueMetaCache();
  assert.deepEqual(await resolveDefaultLeague("poe2", { config: CONFIG, makeRepo, trace }), {
    league: "Forbidden Rites",
    source: "db",
    unpricedFallbackFrom: "Ghost League",
  });
  assert.deepEqual(traced.map((e) => e.phase), ["league-meta.default.unpriced"]);
  // Unlike the read errors, this path runs on cache hits too — it must not log
  // once per request.
  await resolveDefaultLeague("poe2", { config: CONFIG, makeRepo, trace });
  await resolveDefaultLeague("poe2", { config: CONFIG, makeRepo, trace });
  assert.equal(traced.length, 1, "the substitution is traced once per cache entry, not per resolve");

  // An env pin to a league we hold no prices for is superseded the same way —
  // pinning a league before its first candle lands is exactly the day-one
  // re-scope the rule exists to prevent. The pin applies once data arrives.
  process.env.LEAGUE = "Ghost League";
  try {
    resetLeagueMetaCache();
    const pinned = await resolveDefaultLeague("poe2", { config: CONFIG, makeRepo, trace: () => {} });
    assert.equal(pinned.league, "Forbidden Rites");
    assert.equal(pinned.source, "env");
    assert.equal(pinned.unpricedFallbackFrom, "Ghost League");

    resetLeagueMetaCache();
    const priced = await resolveDefaultLeague("poe2", {
      config: CONFIG,
      trace: () => {},
      makeRepo: repoWith(metaRow("Ghost League"), metaRow("Forbidden Rites")),
    });
    assert.deepEqual(priced, { league: "Ghost League", source: "env" });
  } finally {
    delete process.env.LEAGUE;
  }

  // Only permanent leagues have data: still better than serving nothing.
  resetLeagueMetaCache();
  const permanentOnly = await resolveDefaultLeague("poe2", {
    config: CONFIG,
    trace: () => {},
    makeRepo: repoWith(metaRow("Standard", { isPermanent: true, isDefault: true, pairCount: 0 }), metaRow("Hardcore", { isPermanent: true })),
  });
  assert.equal(permanentOnly.league, "Hardcore");

  // Nothing anywhere has data: keep the chosen league rather than inventing one.
  resetLeagueMetaCache();
  assert.deepEqual(
    await resolveDefaultLeague("poe2", { config: CONFIG, trace: () => {}, makeRepo: repoWith(metaRow("Ghost League", { pairCount: 0, isDefault: true })) }),
    { league: "Ghost League", source: "db" },
  );
});

test("a cold burst issues one read, not one per concurrent request", async () => {
  let reads = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const makeRepo = () => ({
    readLeagueMeta: async () => {
      reads += 1;
      await gate;
      return [metaRow("Forbidden Rites", { isDefault: true })];
    },
  });
  resetLeagueMetaCache();
  const burst = Promise.all(
    Array.from({ length: 8 }, () => resolveDefaultLeague("poe2", { config: CONFIG, makeRepo })),
  );
  release();
  const resolved = await burst;
  assert.equal(reads, 1, "the in-flight promise must be cached, not just its result");
  assert.ok(resolved.every((r) => r.league === "Forbidden Rites"));
});

test("a missing league_meta table falls back silently to the code default, with a trace", async () => {
  const traced = [];
  const makeRepo = () => ({
    readLeagueMeta: async () => {
      const error = new Error('relation "league_meta" does not exist');
      error.code = "42P01";
      throw error;
    },
  });
  resetLeagueMetaCache();
  const resolved = await resolveDefaultLeague("poe2", {
    config: CONFIG,
    makeRepo,
    trace: (phase, details) => traced.push({ phase, ...details }),
  });
  assert.deepEqual(resolved, { league: "Runes of Aldur", source: "fallback" });
  assert.deepEqual(traced.map((e) => e.phase), ["league-meta.table-missing"]);

  // Any other database error is a distinct phase — never silently swallowed.
  traced.length = 0;
  resetLeagueMetaCache();
  await resolveDefaultLeague("poe2", {
    config: CONFIG,
    trace: (phase, details) => traced.push({ phase, ...details }),
    makeRepo: () => ({ readLeagueMeta: async () => { throw new Error("boom"); } }),
  });
  assert.deepEqual(traced.map((e) => e.phase), ["league-meta.read.error"]);
});

test("resolved league metadata is cached per process and invalidated on demand", async () => {
  let calls = 0;
  const makeRepo = () => ({
    readLeagueMeta: async () => {
      calls += 1;
      return [];
    },
  });
  resetLeagueMetaCache();
  await readLeagueMetaCached("poe2", { config: CONFIG, makeRepo });
  await readLeagueMetaCached("poe2", { config: CONFIG, makeRepo });
  assert.equal(calls, 1, "a warm process must not re-read on every request");
  resetLeagueMetaCache("poe2");
  await readLeagueMetaCached("poe2", { config: CONFIG, makeRepo });
  assert.equal(calls, 2);
  // The TTL expires on its own.
  await readLeagueMetaCached("poe2", { config: CONFIG, makeRepo, now: Date.now() + 120_000 });
  assert.equal(calls, 3);
});

test("the SQL repository maps the league-meta aggregate and reads it back", async () => {
  const queries = [];
  const results = [
    // refreshLeagueMeta: the aggregate
    [
      {
        league: "Runes of Aldur",
        first_seen_at: NOW - 100 * HOUR,
        last_seen_at: NOW,
        pair_count: "640",
        completed_hours: "100",
      },
      { league: "", first_seen_at: null, last_seen_at: null, pair_count: "0", completed_hours: "0" },
    ],
    // the upsert
    [],
    // readLeagueMeta at the end of refreshLeagueMeta
    [
      {
        league: "Runes of Aldur",
        first_seen_at: NOW - 100 * HOUR,
        last_seen_at: NOW,
        pair_count: 640,
        completed_hours: 100,
        is_public: true,
        is_permanent: false,
        is_default: true,
      },
    ],
  ];
  let i = 0;
  const sql = (strings, ...values) => {
    queries.push({ text: strings.join("?"), values });
    return Promise.resolve(results[i++] ?? []);
  };
  const repo = createRadarRepository({ sql, scope: SCOPE });
  const rows = await repo.refreshLeagueMeta({ now: new Date(NOW) });

  assert.deepEqual(rows, [
    {
      game: "poe2",
      realm: "poe2",
      provider: "live",
      league: "Runes of Aldur",
      firstSeenAt: NOW - 100 * HOUR,
      lastSeenAt: NOW,
      pairCount: 640,
      completedHours: 100,
      isPublic: true,
      isPermanent: false,
      isDefault: true,
    },
  ]);
  // One bounded aggregate, grouped by league, over the (game, realm, provider)
  // stream — the shape the primary-key index can serve as an index-only scan.
  assert.match(queries[0].text, /count\(distinct pair_id\)/);
  assert.match(queries[0].text, /count\(distinct completed_hour\)/);
  assert.match(queries[0].text, /group by league/);
  assert.match(queries[0].text, /completed_hour >= now\(\) - make_interval/);
  assert.deepEqual(queries[0].values.slice(0, 3), ["poe2", "poe2", "live"]);
  // The blank league name never reaches the upsert.
  assert.equal(queries[1].values.includes(""), false);
  assert.match(queries[1].text, /least\(league_meta\.first_seen_at, excluded\.first_seen_at\)/);
});

/**
 * The last-resort branch of the unpriced guard: rows the depth rule rejects for
 * reasons other than depth (here, an inconsistent completedHours of 0) fall
 * through to "newest lastSeenAt wins". That reduce must still respect what may
 * become the SEO scope for 600 pages.
 */
test("the last-resort priced fallback prefers a challenge league over a permanent one", async () => {
  resetLeagueMetaCache();
  const resolved = await resolveDefaultLeague("poe2", {
    config: CONFIG,
    trace: () => {},
    makeRepo: repoWith(
      metaRow("Ghost League", { pairCount: 0, completedHours: 0, isDefault: true }),
      metaRow("Standard", { isPermanent: true, completedHours: 0, lastSeenAt: NOW }),
      metaRow("Forbidden Rites", { completedHours: 0, lastSeenAt: NOW - 5 * HOUR }),
    ),
  });
  // Standard was seen more recently, but a permanent league is never preferred
  // over a challenge league we also hold prices for.
  assert.equal(resolved.league, "Forbidden Rites");
  assert.equal(resolved.unpricedFallbackFrom, "Ghost League");
});

test("the last-resort priced fallback falls back to a permanent league, never a private one", async () => {
  resetLeagueMetaCache();
  const resolved = await resolveDefaultLeague("poe2", {
    config: CONFIG,
    trace: () => {},
    makeRepo: repoWith(
      metaRow("Ghost League", { pairCount: 0, completedHours: 0, isDefault: true }),
      metaRow("Standard", { isPermanent: true, completedHours: 0, lastSeenAt: NOW - 5 * HOUR }),
      metaRow("Taras Test (PL12345)", { isPublic: false, completedHours: 0, lastSeenAt: NOW }),
    ),
  });
  assert.equal(resolved.league, "Standard");
});

test("a private league is never served, even when it is the only priced league", async () => {
  resetLeagueMetaCache();
  const resolved = await resolveDefaultLeague("poe2", {
    config: CONFIG,
    trace: () => {},
    makeRepo: repoWith(
      metaRow("Ghost League", { pairCount: 0, completedHours: 0, isDefault: true }),
      metaRow("Taras Test (PL12345)", { isPublic: false, completedHours: 0, lastSeenAt: NOW }),
    ),
  });
  // Nothing public has data: keep the chosen league rather than re-scoping the
  // whole site onto a throwaway ten-player economy.
  assert.deepEqual(resolved, { league: "Ghost League", source: "db" });
});
