import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/server/config.js";
import { createGggCdnCxapiProvider } from "../src/providers/ggg-cdn-cxapi-provider.js";
import { ingestLive, ingestLiveStreams, rotateStreams } from "../src/server/radar-ingest.js";

test("config: default streams cover only the PoE2 product read scope", () => {
  const cfg = loadConfig({});
  assert.deepEqual(cfg.cxapiStreams, [{ game: "poe2", realm: "poe2" }]);
});

test("config: ingest mode follows read mode by default but can be decoupled", () => {
  assert.equal(loadConfig({}).ingestProviderMode, "fixture");
  assert.equal(loadConfig({ PROVIDER_MODE: "live" }).ingestProviderMode, "live");
  const preseed = loadConfig({ PROVIDER_MODE: "fixture", INGEST_PROVIDER_MODE: "live" });
  assert.equal(preseed.providerMode, "fixture");
  assert.equal(preseed.ingestProviderMode, "live");
});

test("config: live digest cap defaults to one and is bounded at four", () => {
  assert.equal(loadConfig({}).cxapiDigestsPerRun, 1);
  assert.equal(loadConfig({ CXAPI_DIGESTS_PER_RUN: "3" }).cxapiDigestsPerRun, 3);
  assert.equal(loadConfig({ CXAPI_DIGESTS_PER_RUN: "99" }).cxapiDigestsPerRun, 4);
});

test("config: CXAPI_STREAMS overrides, ignoring malformed entries", () => {
  const cfg = loadConfig({ CXAPI_STREAMS: "poe2:poe2, xbox:xbox , junk, :bad" });
  assert.deepEqual(cfg.cxapiStreams, [
    { game: "poe2", realm: "poe2" },
    { game: "xbox", realm: "xbox" },
  ]);
});

test("cdn provider: realm maps to the CDN path segment (poe1 has none)", async () => {
  const urlFor = async (realm) => {
    let seen;
    const p = createGggCdnCxapiProvider({
      poeRealm: realm, cxapiTimeoutMs: 1000, userAgent: "a",
      _cxFetch: async (url) => { seen = url; return { ok: true, status: 200, async json() { return { next_change_id: 100, markets: [] }; } }; },
    });
    await p.fetchDigest({ id: 100 });
    return seen;
  };
  const base = "https://web.poecdn.com/api/currency-exchange";
  assert.equal(await urlFor("poe2"), `${base}/poe2/100`);
  assert.equal(await urlFor("xbox"), `${base}/xbox/100`);
  // PoE1 PC is the CDN default: no realm segment.
  assert.equal(await urlFor("poe1"), `${base}/100`);
});

test("ingestLive with league=null keeps ALL public leagues, drops private", async () => {
  const markets = [
    { league: "Standard", market_id: "a|b", lowest_ratio: { a: 1, b: 2 }, highest_ratio: { a: 1, b: 2 } },
    { league: "Runes of Aldur", market_id: "a|b", lowest_ratio: { a: 1, b: 3 }, highest_ratio: { a: 1, b: 3 } },
    { league: "HC Runes of Aldur", market_id: "a|b", lowest_ratio: { a: 1, b: 4 }, highest_ratio: { a: 1, b: 4 } },
    { league: "Sneaky (PL999)", market_id: "a|b", lowest_ratio: { a: 1, b: 5 }, highest_ratio: { a: 1, b: 5 } },
  ];
  const provider = {
    configured: true,
    async fetchDigest() {
      // a completed hour (next = id + 3600); maxDigests:1 stops after one
      return { digestId: 1000, payload: { next_change_id: 4600, markets } };
    },
  };
  const recorded = [];
  const repo = {
    async readCxapiState() { return { cursor: 1000, lastDigestId: null }; },
    async recordCxDigest(d) { recorded.push(d); return d.candles.length; },
  };
  await ingestLive({ repo, provider, league: null, maxDigests: 1 });
  const leagues = new Set(recorded.flatMap((d) => d.candles.map((c) => c.league)));
  assert.deepEqual([...leagues].sort(), ["HC Runes of Aldur", "Runes of Aldur", "Standard"]);
});

test("ingestLiveStreams: each stream gets its own scope, provider realm, cursor", async () => {
  const config = {
    league: "Runes of Aldur", cxapiSource: "cdn", cxapiStartId: null,
    cxapiMaxBackfillHours: 48,
    cxapiStreams: [{ game: "poe1", realm: "poe1" }, { game: "poe2", realm: "poe2" }],
  };
  const scopes = [];
  const realms = [];
  const makeRepo = (scope) => {
    scopes.push(scope);
    return {
      async readCxapiState() { return { cursor: 5000, lastDigestId: null }; }, // has cursor => 1 digest
      async recordCxDigest(d) { return d.candles.length; },
    };
  };
  const makeProvider = (cfg) => {
    realms.push(cfg.poeRealm);
    return {
      configured: true,
      async fetchDigest({ id }) {
        return { digestId: id, payload: { next_change_id: id, markets: [] } }; // terminal
      },
    };
  };
  const out = await ingestLiveStreams({ streams: config.cxapiStreams, config, now: 1_784_600_000_000, makeRepo, makeProvider });
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((s) => `${s.game}/${s.realm}`), ["poe1/poe1", "poe2/poe2"]);
  assert.deepEqual(scopes.map((s) => `${s.game}/${s.realm}/${s.mode}`), ["poe1/poe1/live", "poe2/poe2/live"]);
  assert.deepEqual(realms, ["poe1", "poe2"]); // provider built per-stream with the stream realm
  assert.ok(out.every((s) => s.mode === "live"));
});

test("ingestLiveStreams reuses the stream state instead of reading the cursor twice", async () => {
  const config = {
    league: "L",
    cxapiSource: "cdn",
    cxapiStartId: null,
    cxapiMaxBackfillHours: 48,
    cxapiDigestsPerRun: 1,
    cxapiStreams: [{ game: "poe2", realm: "poe2" }],
  };
  let stateReads = 0;
  let fetches = 0;
  const makeRepo = () => ({
    async readCxapiState() { stateReads += 1; return { cursor: 1000, lastDigestId: null }; },
    async recordCxDigest(d) { return d.candles.length; },
  });
  const makeProvider = () => ({
    configured: true,
    async fetchDigest({ id }) {
      fetches += 1;
      return { digestId: id, payload: { next_change_id: id + 3600, markets: [] } };
    },
  });
  await ingestLiveStreams({ streams: config.cxapiStreams, config, now: 1_784_600_000_000, makeRepo, makeProvider });
  assert.equal(stateReads, 1);
  assert.equal(fetches, 1, "one digest per invocation while runtime timing is being proven");
});

test("ingestLiveStreams stores every public league for the selector", async () => {
  const config = {
    league: "Runes of Aldur",
    cxapiSource: "cdn",
    cxapiStartId: null,
    cxapiMaxBackfillHours: 48,
    cxapiDigestsPerRun: 1,
    cxapiStreams: [{ game: "poe2", realm: "poe2" }],
  };
  let saved = [];
  const makeRepo = () => ({
    async readCxapiState() { return { cursor: 1000, lastDigestId: null }; },
    async recordCxDigest(digest) { saved = digest.candles; return saved.length; },
  });
  const market = (league) => ({
    league,
    market_id: "a|b",
    lowest_ratio: { a: 1, b: 2 },
    highest_ratio: { a: 1, b: 3 },
  });
  const makeProvider = () => ({
    configured: true,
    async fetchDigest({ id }) {
      return {
        digestId: id,
        payload: {
          next_change_id: id + 3600,
          markets: [market("Runes of Aldur"), market("HC Runes of Aldur"), market("Standard"), market("Private (PL123)")],
        },
      };
    },
  });
  await ingestLiveStreams({ streams: config.cxapiStreams, config, now: 1_784_600_000_000, makeRepo, makeProvider });
  assert.deepEqual([...new Set(saved.map((c) => c.league))].sort(), ["HC Runes of Aldur", "Runes of Aldur", "Standard"]);
});

test("ingestLiveStreams: a null repo (no DB) skips that stream, not the run", async () => {
  const config = { league: "L", cxapiSource: "cdn", cxapiStartId: null, cxapiMaxBackfillHours: 48,
    cxapiStreams: [{ game: "poe1", realm: "poe1" }, { game: "poe2", realm: "poe2" }] };
  const makeRepo = (scope) => scope.game === "poe1" ? null : ({
    async readCxapiState() { return { cursor: 5000 }; },
    async recordCxDigest(d) { return d.candles.length; },
  });
  const makeProvider = () => ({ configured: true, async fetchDigest({ id }) { return { digestId: id, payload: { next_change_id: id, markets: [] } }; } });
  const out = await ingestLiveStreams({ streams: config.cxapiStreams, config, now: 1_784_600_000_000, makeRepo, makeProvider });
  assert.deepEqual(out.map((s) => s.game), ["poe2"]); // poe1 skipped (no repo), poe2 still ran
});

test("ingestLiveStreams: a spent budget skips remaining streams (cursor persists)", async () => {
  const config = { league: "L", cxapiSource: "cdn", cxapiStartId: null, cxapiMaxBackfillHours: 48,
    cxapiStreams: [{ game: "poe1", realm: "poe1" }, { game: "poe2", realm: "poe2" }] };
  let recorded = 0;
  const makeRepo = () => ({ async readCxapiState() { return { cursor: 1000 }; }, async recordCxDigest(d) { recorded += 1; return d.candles.length; } });
  const makeProvider = () => ({ configured: true, async fetchDigest({ id }) { return { digestId: id, payload: { next_change_id: id, markets: [] } }; } });
  const out = await ingestLiveStreams({ streams: config.cxapiStreams, config, now: 1_784_600_000_000, makeRepo, makeProvider, budgetMs: 0 });
  assert.deepEqual(out.map((s) => s.skipped), ["budget", "budget"]);
  assert.equal(recorded, 0); // nothing fetched or written once the budget is spent
});

test("ingestLive: deadline stops the digest loop early, cursor left for next run", async () => {
  let calls = 0;
  const provider = { configured: true, async fetchDigest({ id }) { calls += 1; return { digestId: id, payload: { next_change_id: id + 3600, markets: [] } }; } };
  const repo = { async readCxapiState() { return { cursor: 1000 }; }, async recordCxDigest(d) { return d.candles.length; } };
  let n = 0;
  const out = await ingestLive({ repo, provider, maxDigests: 5, deadline: () => n++ >= 1 });
  assert.equal(out.digests, 1); // one digest, then the deadline trips before the 2nd
  assert.equal(calls, 1);
});

test("ingestLiveStreams: partial — stream 1 runs, stream 2 skipped when budget spent", async () => {
  const config = { league: "L", cxapiSource: "cdn", cxapiStartId: null, cxapiMaxBackfillHours: 48, cxapiTimeoutMs: 10000,
    cxapiStreams: [{ game: "poe1", realm: "poe1" }, { game: "poe2", realm: "poe2" }] };
  let t = 0;
  const clock = () => t;
  const makeRepo = () => ({ async readCxapiState() { return { cursor: 1000 }; }, async recordCxDigest(d) { t = 80000; return d.candles.length; } });
  const makeProvider = () => ({ configured: true, async fetchDigest({ id }) { return { digestId: id, payload: { next_change_id: id + 3600, markets: [] } }; } });
  const out = await ingestLiveStreams({ streams: config.cxapiStreams, config, now: 0, makeRepo, makeProvider, budgetMs: 100000, clock });
  assert.equal(out[0].game, "poe1");
  assert.ok(!out[0].skipped, "stream 1 ran");
  assert.equal(out[1].skipped, "budget", "stream 2 skipped after budget spent mid-run");
});

test("rotateStreams rotates the starting stream by the hour (no starvation)", () => {
  const s = [{ game: "a" }, { game: "b" }, { game: "c" }];
  assert.deepEqual(rotateStreams(s, 0).map((x) => x.game), ["a", "b", "c"]);
  assert.deepEqual(rotateStreams(s, 3600_000).map((x) => x.game), ["b", "c", "a"]);
  assert.deepEqual(rotateStreams(s, 2 * 3600_000).map((x) => x.game), ["c", "a", "b"]);
  assert.deepEqual(rotateStreams([{ game: "solo" }], 99 * 3600_000).map((x) => x.game), ["solo"]);
});
