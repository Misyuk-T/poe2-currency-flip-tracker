import test from "node:test";
import assert from "node:assert/strict";
import { usagePayload, USAGE_EVENTS } from "../apps/web/lib/usage-events.js";
import { createUsageLimiter, handleUsage } from "../apps/web/lib/usage-handler.js";
import { recordUsage } from "../apps/web/lib/usage-client.js";

const valid = { event: "market_saved", game: "poe2" };
function request(body = valid, headers = {}, options = {}) {
  return new Request("https://exileradar.com/api/usage", {
    method: "POST", headers: { origin: "https://exileradar.com", "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body), ...options,
  });
}

test("usage contract admits four coarse events and rejects identifiers or entered values", () => {
  assert.equal(USAGE_EVENTS.length, 4);
  for (const event of USAGE_EVENTS) assert.deepEqual(usagePayload({ event, game: "poe1" }), { event, game: "poe1" });
  for (const body of [null, [], {}, { ...valid, event: "unknown" }, { ...valid, game: "other" },
    { ...valid, price: 123 }, { ...valid, userId: "player" }, { ...valid, league: "Standard" }]) {
    assert.equal(usagePayload(body), null);
  }
});

test("collector only writes validated same-origin JSON and returns no-store", async () => {
  const writes = [];
  const record = async (event) => writes.push(event);
  const res = await handleUsage(request(), { record });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.deepEqual(writes, [valid]);
  for (const [req, status] of [
    [request(valid, { origin: "https://other.example" }), 403],
    [request(valid, { "sec-fetch-site": "cross-site" }), 403],
    [request(valid, { "content-type": "text/plain" }), 415],
    [request("{"), 400], [request({ ...valid, price: 125 }), 400],
    [request(" ".repeat(257)), 400], [request(valid, { "content-length": "999" }), 400],
  ]) assert.equal((await handleUsage(req, { record })).status, status);
  assert.equal(writes.length, 1);
  assert.equal((await handleUsage(request(), { record, allow: () => false })).status, 429);
  assert.equal((await handleUsage(request(valid, { dnt: "1" }), { record })).status, 204);
  assert.equal((await handleUsage(request(valid, { "sec-gpc": "1" }), { record })).status, 204);
  assert.equal(writes.length, 1);
  assert.equal((await handleUsage(request(), { record: async () => { throw new Error("offline"); } })).status, 503);
});

test("collector bounds chunked bodies without relying on Content-Length", async () => {
  let writes = 0;
  const body = new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array(150)); controller.enqueue(new Uint8Array(150)); controller.close();
  } });
  const res = await handleUsage(request(body, {}, { body, duplex: "half" }), { record: async () => writes++ });
  assert.equal(res.status, 400);
  assert.equal(writes, 0);
});

test("usage limiter bounds traffic and memory, then releases expired buckets", () => {
  let time = 0;
  const allow = createUsageLimiter({ now: () => time, limit: 2, maxKeys: 2 });
  assert.equal(allow("one"), true); assert.equal(allow("one"), true); assert.equal(allow("one"), false);
  assert.equal(allow("two"), true); assert.equal(allow("three"), false);
  time = 60000;
  assert.equal(allow("three"), true); assert.equal(allow("one"), true);
});

test("client dedupes browser-day markers before sending; fixture/opt-out/failure are nonblocking", async () => {
  const original = Object.fromEntries(["window", "navigator", "fetch"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const data = new Map(); const calls = [];
  try {
    Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: {
      getItem: (key) => data.get(key), setItem: (key, value) => data.set(key, value),
    } } });
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
    globalThis.fetch = async (url, options) => { calls.push({ url, options }); throw new Error("offline"); };
    assert.equal(recordUsage("market_saved", { game: "poe1", sourceMode: "fixture" }), false);
    navigator.doNotTrack = "1";
    assert.equal(recordUsage("market_saved", { game: "poe1", sourceMode: "official" }), false);
    delete navigator.doNotTrack;
    navigator.globalPrivacyControl = true;
    assert.equal(recordUsage("market_saved", { game: "poe1", sourceMode: "official" }), false);
    delete navigator.globalPrivacyControl;
    assert.equal(recordUsage("market_saved", { game: "poe1", sourceMode: "official" }), true);
    assert.equal(recordUsage("market_saved", { game: "poe1", sourceMode: "official" }), false);
    await Promise.resolve();
    assert.equal(calls.length, 1);
    assert.deepEqual(JSON.parse(calls[0].options.body), { event: "market_saved", game: "poe1" });
    assert.equal(calls[0].url, "/api/usage");
    assert.equal(data.size, 1);
    window.localStorage.setItem = () => { throw new Error("blocked"); };
    assert.equal(recordUsage("manual_price_applied", { game: "poe1", sourceMode: "official" }), false);
  } finally {
    for (const [key, descriptor] of Object.entries(original)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
});
