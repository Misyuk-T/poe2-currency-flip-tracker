import test from "node:test";
import assert from "node:assert/strict";
import { createGggCdnCxapiProvider } from "../src/providers/ggg-cdn-cxapi-provider.js";

const base = { poeRealm: "poe2", cxapiTimeoutMs: 1000, userAgent: "agent/1.0" };

function providerReturning(body, { status = 200, ok = true } = {}) {
  let seen;
  const p = createGggCdnCxapiProvider({
    ...base,
    _cxFetch: async (url, opts) => {
      seen = { url, headers: opts.headers };
      return { ok, status, async json() { return body; } };
    },
  });
  return { p, seen: () => seen };
}

test("cdn provider is public: configured, unauthenticated, hits web.poecdn.com", async () => {
  const { p, seen } = providerReturning({ next_change_id: 1784617200, markets: [] });
  assert.equal(p.configured, true);
  assert.equal(p.mode, "live");
  await p.fetchDigest({ id: 1784613600 });
  const s = seen();
  assert.ok(s.url.startsWith("https://web.poecdn.com/api/currency-exchange/poe2/"));
  assert.ok(s.url.endsWith("/1784613600"));
  assert.equal(s.headers.Authorization, undefined); // never sends a Bearer
  assert.equal(s.headers["User-Agent"], "agent/1.0");
  assert.equal(s.headers.Accept, "application/json");
  assert.equal(JSON.stringify(p).includes("Bearer"), false);
});

test("cdn provider: digest is FOR the requested hour (not next-3600)", async () => {
  // Requested id=06:00, next advertises 07:00. The markets belong to 06:00.
  const { p } = providerReturning({ next_change_id: 1784617200, markets: [] });
  const d = await p.fetchDigest({ id: 1784613600 });
  assert.equal(d.digestId, 1784613600);
  assert.equal(Number(d.payload.next_change_id), 1784617200);
});

test("cdn provider: terminal (next === requested id) keeps digestId = requested id", async () => {
  // Live edge: the in-progress hour returns next_change_id === id with no markets.
  // The old next-3600 derivation would mislabel this as the previous hour.
  const id = 1784624400;
  const { p } = providerReturning({ next_change_id: id, markets: [] });
  const d = await p.fetchDigest({ id });
  assert.equal(d.digestId, id);
});

test("cdn provider: bootstrap (no id) resolves digest from next-3600", async () => {
  const { p } = providerReturning({ next_change_id: 1784617200, markets: [] });
  const d = await p.fetchDigest();
  assert.equal(d.digestId, 1784617200 - 3600);
});

test("cdn provider: rejects a backward next_change_id", async () => {
  const { p } = providerReturning({ next_change_id: 1784610000, markets: [] });
  await assert.rejects(() => p.fetchDigest({ id: 1784613600 }), (e) => e.code === "malformed");
});

test("cdn provider: missing next_change_id is malformed", async () => {
  const { p } = providerReturning({ markets: [] });
  await assert.rejects(() => p.fetchDigest({ id: 1 }), (e) => e.code === "malformed");
});

test("cdn provider: missing markets array is malformed", async () => {
  const { p } = providerReturning({ next_change_id: 1784617200 });
  await assert.rejects(() => p.fetchDigest({ id: 1 }), (e) => e.code === "malformed");
});

test("cdn provider: maps 429 and non-ok statuses to typed errors", async () => {
  const rl = providerReturning({}, { status: 429, ok: false });
  await assert.rejects(() => rl.p.fetchDigest({ id: 1 }), (e) => e.code === "rate-limited");
  const http = providerReturning({}, { status: 503, ok: false });
  await assert.rejects(() => http.p.fetchDigest({ id: 1 }), (e) => e.code === "http");
});

test("cdn provider: wraps network failures", async () => {
  const p = createGggCdnCxapiProvider({
    ...base,
    _cxFetch: async () => { throw new Error("boom"); },
  });
  await assert.rejects(() => p.fetchDigest({ id: 1 }), (e) => e.code === "network");
});
