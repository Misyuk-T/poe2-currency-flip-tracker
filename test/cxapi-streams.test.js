import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/server/config.js";
import { createGggCdnCxapiProvider } from "../src/providers/ggg-cdn-cxapi-provider.js";
import { ingestLive, ingestLiveStreams } from "../src/server/radar-ingest.js";

test("config: default streams cover PoE1 + PoE2", () => {
  const cfg = loadConfig({});
  assert.deepEqual(cfg.cxapiStreams, [
    { game: "poe1", realm: "poe1" },
    { game: "poe2", realm: "poe2" },
  ]);
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
      // terminal digest (next == id) so the loop stops after one
      return { digestId: 1000, payload: { next_change_id: 1000, markets } };
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
