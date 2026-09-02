import test from "node:test";
import assert from "node:assert/strict";

import { createMemoryRepository } from "../apps/web/lib/memory-repo.js";
import {
  REPOE_BASE_ITEM_URLS,
  TRADE_STATIC_URLS,
  catalogItemsFromTradeStatic,
  identityRowFor,
  observedMetadataIds,
  refreshCurrencyIdentity,
  selectIdentityCandidates,
} from "../apps/web/lib/identity-refresh.js";

const NOW = Date.parse("2026-09-02T04:20:00Z");
const HOUR = 3_600_000;
const DAY = 86_400_000;

const CONFIG = {
  poeGame: "poe2",
  poeRealm: "poe2",
  league: "Runes of Aldur",
  poe1League: "Standard",
  providerMode: "live",
  cxapiStreams: [{ game: "poe2", realm: "poe2" }],
};
const SCOPE = { game: "poe2", realm: "poe2", league: "Runes of Aldur", mode: "live" };

const TAIL = "Metadata/Items/Currency/CurrencyBrandNewThing";
const TAIL_TWO = "Metadata/Items/Currency/CurrencySecondNewThing";
// Already answered by the committed src/data/cx-identity-poe2.json.
const EXALTED = "Metadata/Items/Currency/CurrencyAddModToRare";

/** RePoE-shaped payload padded past the job's sanity floor. */
function baseItemsPayload(extra = {}) {
  const items = { ...extra };
  for (let i = 0; i < 1_200; i += 1) {
    items[`Metadata/Items/Filler/Filler${i}`] = { name: `Filler ${i}`, item_class: "Filler" };
  }
  return items;
}

/** GGG trade-static-shaped payload padded past the job's sanity floor. */
function staticPayload(entries = []) {
  const filler = Array.from({ length: 150 }, (_, i) => ({ id: `filler-${i}`, text: `Filler ${i}` }));
  return { result: [{ id: "currency", label: "Currency", entries: [...entries, ...filler] }] };
}

function fetchStub(byUrl, calls = []) {
  return async (url) => {
    calls.push(url);
    const body = byUrl[url];
    if (body === undefined) throw new Error(`unexpected fetch: ${url}`);
    if (body instanceof Error) throw body;
    return { ok: true, json: async () => body };
  };
}

/** A memory repo seeded with candles for the given currency ids against the anchor. */
async function seedRepo(ids, { now = NOW } = {}) {
  const repo = createMemoryRepository(SCOPE);
  await repo.recordCxDigest({
    digestId: 1,
    candles: ids.map((id, index) => ({
      league: SCOPE.league,
      completedHour: now - (index + 1) * HOUR,
      pairId: [id, "exalted"].sort().join("|"),
      base: id,
      quote: "exalted",
      reference: 1,
    })),
  });
  return repo;
}

test("candidate selection skips committed ids, resolved rows, and recently retried placeholders", () => {
  const observed = ["exalted", EXALTED, TAIL, TAIL_TWO, "Metadata/Items/Currency/CurrencyThird"];
  const existing = [
    // Fully resolved: never re-fetched.
    { metadataId: TAIL, icon: "https://example.test/a.png", updatedAt: NOW - 30 * DAY },
    // Placeholder retried yesterday: inside the window, skip.
    { metadataId: TAIL_TWO, icon: null, updatedAt: NOW - DAY },
  ];
  const { unresolved, candidates } = selectIdentityCandidates(observed, existing, { game: "poe2", now: NOW });
  assert.deepEqual(unresolved, [TAIL, TAIL_TWO, "Metadata/Items/Currency/CurrencyThird"]);
  assert.deepEqual(candidates, ["Metadata/Items/Currency/CurrencyThird"]);

  // Once the placeholder ages past the retry window it comes back.
  const aged = selectIdentityCandidates(observed, [{ metadataId: TAIL_TWO, icon: null, updatedAt: NOW - 8 * DAY }], {
    game: "poe2",
    now: NOW,
  });
  assert.ok(aged.candidates.includes(TAIL_TWO));
});

test("row shaping records how much upstream actually knew", () => {
  const resolved = identityRowFor(TAIL, {
    name: "Brand New Orb",
    art: "2DItems/Currency/New",
    shortId: "brand-new-orb",
    icon: "https://example.test/new.png",
    category: "Currency",
    taxonomySource: "official-id",
  }, { game: "poe2", knownUpstream: true });
  assert.deepEqual(resolved, {
    metadataId: TAIL,
    name: "Brand New Orb",
    icon: "https://example.test/new.png",
    category: "Currency",
    // Derived presentation taxonomy is not stored; see identityRowFor.
    subcategory: null,
    shortId: "brand-new-orb",
    source: "repoe-catalog",
  });

  // No catalog match: the CDN URL is derived from the art path, exactly as the
  // reader would derive it.
  const derived = identityRowFor(TAIL, { name: "Brand New Orb", art: "2DItems/Currency/New", category: null }, {
    game: "poe2",
    knownUpstream: true,
  });
  assert.equal(derived.icon, "https://web.poecdn.com/image/Art/2DItems/Currency/New.png?scale=1&realm=poe2");

  const placeholder = identityRowFor(TAIL, { name: "Currency Brand New Thing" }, { game: "poe2", knownUpstream: false });
  assert.deepEqual([placeholder.icon, placeholder.source], [null, "humanized"]);
});

test("a guessed category is stored as null so the committed JSON keeps answering", () => {
  // repo-class is RePoE's item class humanized, not an official trade category.
  // Storing it would permanently shadow a better category from a later
  // identity:build, because the reader takes DB over JSON and the upsert never
  // degrades a field.
  for (const taxonomySource of ["repo-class", "unresolved", undefined]) {
    const row = identityRowFor(TAIL, {
      name: "Brand New Orb",
      art: "2DItems/Currency/New",
      category: "Stackable Currency",
      taxonomySource,
    }, { game: "poe2", knownUpstream: true });
    assert.equal(row.category, null, `${taxonomySource} must not be stored as a category`);
    // The name and the derived icon are still worth storing.
    assert.equal(row.name, "Brand New Orb");
    assert.equal(row.icon, "https://web.poecdn.com/image/Art/2DItems/Currency/New.png?scale=1&realm=poe2");
    assert.equal(row.source, "repoe-catalog");
  }

  for (const taxonomySource of ["official-id", "official-name", "official-path-token", "learned-prefix"]) {
    const row = identityRowFor(TAIL, { name: "Brand New Orb", category: "Currency", taxonomySource }, {
      game: "poe2",
      knownUpstream: true,
    });
    assert.equal(row.category, "Currency", `${taxonomySource} is an official answer and must be stored`);
  }
});

test("observed ids are seeded as Metadata paths, reverse-mapped from the stored canonical ids", () => {
  // hourly_market_candles stores canonical short ids for everything the
  // committed bridge knows; both the taxonomy's prefix learning and the
  // short-id collision tie-break key on Metadata paths, so the short ids must
  // be mapped back before they are handed to the resolver.
  const seeded = observedMetadataIds(["exalted", "divine", TAIL, "not-a-real-short-id"], "poe2");
  assert.ok([...seeded].every((id) => id.startsWith("Metadata/")), `expected only Metadata paths, got ${[...seeded]}`);
  assert.ok(seeded.has(EXALTED), "the anchor's short id must map back to its Metadata path");
  assert.ok(seeded.has("Metadata/Items/Currency/CurrencyModValues"), "divine must map back too");
  assert.ok(seeded.has(TAIL), "an already-unmapped Metadata path passes through untouched");
  assert.equal(seeded.has("not-a-real-short-id"), false, "an id with no bridge is dropped, not guessed");
  assert.equal(seeded.size, 3);
});

test("the trade static feed is parsed the way build-catalog.mjs parses it", () => {
  const items = catalogItemsFromTradeStatic({
    result: [
      { id: "currency", label: "Currency", entries: [
        { id: "exalted", text: "Exalted Orb", image: "/gen/image/abc.png" },
        { id: "exalted", text: "Duplicate", image: "/gen/image/dupe.png" },
        { id: "nameless" },
      ] },
      { id: "runes", entries: [{ id: "desert-rune", text: "Desert Rune", image: "https://cdn.test/r.png" }] },
    ],
  });
  assert.deepEqual(items, [
    { id: "exalted", name: "Exalted Orb", category: "Currency", image: "https://www.pathofexile.com/gen/image/abc.png" },
    { id: "desert-rune", name: "Desert Rune", category: "runes", image: "https://cdn.test/r.png" },
  ]);
});

test("the job resolves observed tail ids and reports what it did", async () => {
  const repo = await seedRepo(["exalted", EXALTED, TAIL]);
  const calls = [];
  const traced = [];
  const result = await refreshCurrencyIdentity({
    game: "poe2",
    config: CONFIG,
    now: NOW,
    makeRepo: () => repo,
    trace: (phase, details) => traced.push({ phase, ...details }),
    fetchImpl: fetchStub({
      [REPOE_BASE_ITEM_URLS.poe2]: baseItemsPayload({
        [TAIL]: {
          name: "Brand New Orb",
          item_class: "Stackable Currency",
          visual_identity: { dds_file: "Art/2DItems/Currency/New.dds" },
        },
      }),
      [TRADE_STATIC_URLS.poe2]: staticPayload([{ id: "brand-new-orb", text: "Brand New Orb", image: "/gen/image/new.png" }]),
    }, calls),
  });

  assert.deepEqual(result, { game: "poe2", scanned: 3, unresolved: 1, resolved: 1, written: 1, skipped: 0 });
  assert.deepEqual(calls, [REPOE_BASE_ITEM_URLS.poe2, TRADE_STATIC_URLS.poe2]);
  const [stored] = await repo.readCxIdentity({ game: "poe2" });
  assert.deepEqual(
    [stored.metadataId, stored.name, stored.icon, stored.category, stored.shortId, stored.source],
    [TAIL, "Brand New Orb", "https://www.pathofexile.com/gen/image/new.png", "Currency", "brand-new-orb", "repoe-catalog"],
  );
  assert.equal(stored.resolvedAt, NOW);
  assert.ok(traced.some((entry) => entry.phase === "cx-identity.scan.end"));
  assert.ok(traced.some((entry) => entry.phase === "cx-identity.scope.end"));

  // Second run: the row now has an icon, so nothing is a candidate and NOTHING
  // is fetched.
  const second = await refreshCurrencyIdentity({
    game: "poe2",
    config: CONFIG,
    now: NOW + DAY,
    makeRepo: () => repo,
    fetchImpl: async (url) => { throw new Error(`must not fetch ${url}`); },
  });
  assert.deepEqual(second, { game: "poe2", scanned: 3, unresolved: 1, resolved: 0, written: 0, skipped: 0 });
});

test("a later, poorer answer never blanks a field an earlier run resolved", async () => {
  const repo = await seedRepo([TAIL]);
  await repo.upsertCxIdentity([
    { metadataId: TAIL, name: "Brand New Orb", icon: "https://example.test/good.png", category: "Currency", shortId: "brand-new-orb", source: "repoe-catalog" },
  ], { game: "poe2", now: NOW - 30 * DAY });
  // Force the retry window open, then let upstream answer with nothing useful.
  await repo.upsertCxIdentity([{ metadataId: TAIL, source: "humanized" }], { game: "poe2", now: NOW - 30 * DAY });

  const before = (await repo.readCxIdentity({ game: "poe2" }))[0];
  assert.equal(before.icon, "https://example.test/good.png");

  await repo.upsertCxIdentity([{ metadataId: TAIL, name: null, icon: null, category: null, shortId: null, source: "humanized" }], {
    game: "poe2",
    now: NOW,
  });
  const after = (await repo.readCxIdentity({ game: "poe2" }))[0];
  assert.deepEqual([after.name, after.icon, after.category, after.shortId, after.source], [
    "Brand New Orb",
    "https://example.test/good.png",
    "Currency",
    "brand-new-orb",
    "repoe-catalog",
  ]);
  assert.equal(after.updatedAt, NOW, "the retry clock still moves so the row is not re-fetched every run");
});

test("the per-run cap defers the rest instead of dropping it", async () => {
  const ids = Array.from({ length: 5 }, (_, i) => `Metadata/Items/Currency/CurrencyTail${i}`);
  const repo = await seedRepo(ids);
  const result = await refreshCurrencyIdentity({
    game: "poe2",
    config: CONFIG,
    now: NOW,
    limit: 2,
    makeRepo: () => repo,
    fetchImpl: fetchStub({
      [REPOE_BASE_ITEM_URLS.poe2]: baseItemsPayload(),
      [TRADE_STATIC_URLS.poe2]: staticPayload(),
    }),
  });
  assert.deepEqual([result.unresolved, result.written, result.skipped], [5, 2, 3]);
  // Nothing upstream knew these ids, so they are stored as honest placeholders.
  const stored = await repo.readCxIdentity({ game: "poe2" });
  assert.equal(stored.length, 2);
  assert.deepEqual([stored[0].source, stored[0].icon, stored[0].name], ["humanized", null, "Currency Tail 0"]);
  assert.equal(result.resolved, 0);
});

test("a truncated upstream response is refused by the sanity floor before anything is written", async () => {
  const repo = await seedRepo([TAIL]);
  const traced = [];
  const result = await refreshCurrencyIdentity({
    game: "poe2",
    config: CONFIG,
    now: NOW,
    makeRepo: () => repo,
    trace: (phase, details) => traced.push({ phase, ...details }),
    fetchImpl: fetchStub({
      [REPOE_BASE_ITEM_URLS.poe2]: { [TAIL]: { name: "Brand New Orb" } },
      [TRADE_STATIC_URLS.poe2]: staticPayload(),
    }),
  });
  assert.equal(result.skippedReason, "sanity-floor");
  assert.equal(result.written, 0);
  assert.deepEqual(await repo.readCxIdentity({ game: "poe2" }), []);
  assert.ok(traced.some((entry) => entry.phase === "cx-identity.floor.rejected"));
});

test("an upstream outage retries once, then reports the failure without writing", async () => {
  const repo = await seedRepo([TAIL]);
  const traced = [];
  let attempts = 0;
  const result = await refreshCurrencyIdentity({
    game: "poe2",
    config: CONFIG,
    now: NOW,
    makeRepo: () => repo,
    trace: (phase, details) => traced.push({ phase, ...details }),
    fetchImpl: async (url) => {
      if (url === REPOE_BASE_ITEM_URLS.poe2) {
        attempts += 1;
        throw new Error("network down");
      }
      return { ok: true, json: async () => staticPayload() };
    },
  });
  assert.equal(attempts, 2, "one retry, not an unbounded loop");
  assert.equal(result.written, 0);
  assert.equal(result.error, "network down");
  assert.ok(traced.some((entry) => entry.phase === "cx-identity.fetch.error"));
  assert.deepEqual(await repo.readCxIdentity({ game: "poe2" }), []);
});

test("with no database the job reports a skip, not an error", async () => {
  const result = await refreshCurrencyIdentity({
    game: "poe2",
    config: CONFIG,
    now: NOW,
    makeRepo: () => null,
    fetchImpl: async () => { throw new Error("must not fetch"); },
  });
  assert.equal(result.skippedReason, "no-database");
  assert.deepEqual([result.scanned, result.written], [0, 0]);
});
