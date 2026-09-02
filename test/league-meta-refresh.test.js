import test from "node:test";
import assert from "node:assert/strict";

// No DATABASE_URL: the resolver must never depend on one existing, and the
// repository under test here is the in-memory twin.
delete process.env.DATABASE_URL;
delete process.env.LEAGUE;
delete process.env.POE1_LEAGUE;

import { createRadarRepository } from "../src/storage/radar-repository.js";
import { chooseDefaultLeague } from "../src/domain/league-meta.js";
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

test("day one of a new league: the aggregate keeps Runes of Aldur as the default", async () => {
  const repo = createMemoryRepository(SCOPE);
  // The real shape on 2026-09-04: a deep incumbent, a deep permanent league, and
  // Forbidden Rites twenty hours old.
  await repo.recordCxDigest(digest("Runes of Aldur", { pairs: 200, hours: 60 }));
  await repo.recordCxDigest(digest("Standard", { pairs: 200, hours: 60 }));
  await repo.recordCxDigest(digest("Forbidden Rites", { pairs: 200, hours: 20 }));

  const rows = await repo.refreshLeagueMeta({ now: NOW });
  assert.equal(
    chooseDefaultLeague(rows, { game: "poe2", currentDefault: "Runes of Aldur", now: NOW }),
    "Runes of Aldur",
  );

  // Three days later Forbidden Rites has real depth, and only then does it win.
  const later = NOW + 72 * HOUR;
  await repo.recordCxDigest(digest("Forbidden Rites", { pairs: 200, hours: 72, endsAt: later }));
  const deeper = await repo.refreshLeagueMeta({ now: later });
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
  await seed.recordCxDigest(digest("Forbidden Rites", { pairs: 200, hours: 20 }));

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

test("resolver precedence: env override beats the database, which beats the fallback", async () => {
  const withDefault = (league) => () => ({
    readLeagueMeta: async () => [
      { league, firstSeenAt: NOW, lastSeenAt: NOW, pairCount: 500, completedHours: 168, isPublic: true, isPermanent: false, isDefault: true },
    ],
  });

  resetLeagueMetaCache();
  assert.deepEqual(
    await resolveDefaultLeague("poe2", { config: CONFIG, makeRepo: withDefault("Forbidden Rites") }),
    { league: "Forbidden Rites", source: "db" },
  );

  process.env.LEAGUE = "Pinned League";
  try {
    resetLeagueMetaCache();
    assert.deepEqual(
      await resolveDefaultLeague("poe2", { config: CONFIG, makeRepo: withDefault("Forbidden Rites") }),
      { league: "Pinned League", source: "env" },
    );
    // A blank env var is not an override.
    process.env.LEAGUE = "   ";
    resetLeagueMetaCache();
    assert.equal(
      (await resolveDefaultLeague("poe2", { config: CONFIG, makeRepo: withDefault("Forbidden Rites") })).source,
      "db",
    );
  } finally {
    delete process.env.LEAGUE;
  }

  resetLeagueMetaCache();
  assert.deepEqual(
    await resolveDefaultLeague("poe2", { config: CONFIG, makeRepo: () => ({ readLeagueMeta: async () => [] }) }),
    { league: "Runes of Aldur", source: "fallback" },
  );

  // No database (the local/dev case) is the fallback too, not an error.
  resetLeagueMetaCache();
  assert.deepEqual(
    await resolveDefaultLeague("poe1", { config: CONFIG, makeRepo: () => null }),
    { league: "Standard", source: "fallback" },
  );
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
