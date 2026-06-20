import { test } from "node:test";
import assert from "node:assert/strict";

import { createApp } from "../src/server/app.js";
import { loadConfig } from "../src/server/config.js";
import { createGoldRegistry } from "../src/domain/gold-costs.js";
import { POE2_GOLD_COSTS } from "../src/data/gold-costs-poe2.js";

const goldRegistry = createGoldRegistry(POE2_GOLD_COSTS, { game: "poe2" });

function countingProvider() {
  let calls = 0;
  return {
    mode: "live",
    label: "counting",
    get calls() {
      return calls;
    },
    async fetchExchange() {
      calls++;
      return { id: "x", result: {} };
    },
  };
}

function req(method, url, { headers = {}, ip = "test" } = {}) {
  return { method, url, headers, socket: { remoteAddress: ip } };
}

function mockRes() {
  return {
    statusCode: null,
    headers: null,
    body: null,
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers;
    },
    end(payload) {
      try {
        this.body = JSON.parse(payload);
      } catch {
        this.body = payload;
      }
    },
  };
}

const liveCfg = (over = {}) =>
  loadConfig({ PROVIDER_MODE: "live", SHORTLIST: "divine", POLL_INTERVAL_MS: "600000", ...over });

test("A3: user reads NEVER hit the provider — only the scheduler's refresh() does", async () => {
  const provider = countingProvider();
  const app = createApp(liveCfg(), { provider, goldRegistry });

  // Cold read before any refresh -> 503 warming, provider untouched.
  const cold = mockRes();
  await app.handler(req("GET", "/api/opportunities"), cold);
  assert.equal(cold.statusCode, 503);
  assert.equal(cold.body.state, "warming");
  assert.equal(provider.calls, 0);

  // The scheduler warms the snapshot.
  await app.refresh();
  const warmCalls = provider.calls;
  assert.ok(warmCalls > 0);

  // A routine read is served from cache — no new provider hit.
  const r = mockRes();
  await app.handler(req("GET", "/api/opportunities"), r);
  assert.equal(r.statusCode, 200);
  assert.equal(provider.calls, warmCalls);
});

test("A3: the public ?refresh=1 escape hatch is gone (cannot force a provider fetch)", async () => {
  const provider = countingProvider();
  const app = createApp(liveCfg(), { provider, goldRegistry });
  await app.refresh();
  const warmCalls = provider.calls;

  const r = mockRes();
  await app.handler(req("GET", "/api/opportunities?refresh=1"), r);
  assert.equal(provider.calls, warmCalls, "?refresh=1 must not trigger a provider fetch");
  assert.equal(r.body.forced, undefined);
});

test("refresh() is single-flight: concurrent calls collapse to one provider cycle", async () => {
  const provider = countingProvider();
  // Pin to a single anchor so the cycle is exactly 1 entry batch + 1 exit.
  const app = createApp(liveCfg({ ANCHORS: "exalted" }), { provider, goldRegistry });

  await Promise.all([app.refresh(), app.refresh(), app.refresh()]);
  assert.equal(provider.calls, 2);
});
