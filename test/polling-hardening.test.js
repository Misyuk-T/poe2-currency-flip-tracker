import { test } from "node:test";
import assert from "node:assert/strict";

import { createApp } from "../src/server/app.js";
import { loadConfig } from "../src/server/config.js";
import { createFixtureProvider } from "../src/providers/fixture-provider.js";
import { createGoldRegistry } from "../src/domain/gold-costs.js";
import { POE2_GOLD_COSTS } from "../src/data/gold-costs-poe2.js";

const goldRegistry = createGoldRegistry(POE2_GOLD_COSTS, { game: "poe2" });

function req(method, url, { headers = {}, ip = "test" } = {}) {
  return { method, url, headers, socket: { remoteAddress: ip } };
}
function mockRes() {
  return {
    statusCode: null,
    headers: null,
    body: null,
    writeHead(s, h) {
      this.statusCode = s;
      this.headers = h;
    },
    end(p) {
      try {
        this.body = JSON.parse(p);
      } catch {
        this.body = p;
      }
    },
  };
}

// Provider that succeeds until flipped to fail; counts calls and failures.
function flakyProvider() {
  let calls = 0;
  const p = {
    mode: "live",
    label: "flaky",
    fail: false,
    get calls() {
      return calls;
    },
    async fetchExchange() {
      calls++;
      if (p.fail) throw new Error("boom");
      return { id: "x", result: {} };
    },
  };
  return p;
}

test("per-IP rate limit returns 429 once the window budget is exhausted", async () => {
  const app = createApp(loadConfig({ API_RATE_LIMIT_PER_MIN: "3" }), {
    provider: createFixtureProvider(),
    goldRegistry,
  });
  for (let i = 0; i < 3; i++) {
    const r = mockRes();
    await app.handler(req("GET", "/api/status", { ip: "9.9.9.9" }), r);
    assert.equal(r.statusCode, 200);
  }
  const blocked = mockRes();
  await app.handler(req("GET", "/api/status", { ip: "9.9.9.9" }), blocked);
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.body.error.code, "rate-limited");

  // A different IP is unaffected (separate bucket).
  const other = mockRes();
  await app.handler(req("GET", "/api/status", { ip: "8.8.8.8" }), other);
  assert.equal(other.statusCode, 200);
});

test("admin force-refresh requires the configured token", async () => {
  const provider = flakyProvider();
  const app = createApp(loadConfig({ PROVIDER_MODE: "live", SHORTLIST: "divine", ADMIN_TOKEN: "secret" }), {
    provider,
    goldRegistry,
  });

  const noToken = mockRes();
  await app.handler(req("POST", "/admin/refresh"), noToken);
  assert.equal(noToken.statusCode, 403);
  assert.equal(provider.calls, 0);

  const ok = mockRes();
  await app.handler(req("POST", "/admin/refresh", { headers: { "x-admin-token": "secret" } }), ok);
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.refreshed, true);
  assert.ok(provider.calls > 0);
});

test("admin endpoint is hidden (404) when no token is configured", async () => {
  const provider = flakyProvider();
  const app = createApp(loadConfig({ PROVIDER_MODE: "live", SHORTLIST: "divine" }), { provider, goldRegistry });
  const r = mockRes();
  await app.handler(req("POST", "/admin/refresh", { headers: { "x-admin-token": "anything" } }), r);
  assert.equal(r.statusCode, 404);
  assert.equal(provider.calls, 0);
});

test("circuit breaker opens after consecutive failures and stops hitting the provider", async () => {
  const provider = flakyProvider();
  provider.fail = true;
  const app = createApp(
    loadConfig({
      PROVIDER_MODE: "live",
      SHORTLIST: "divine",
      CIRCUIT_FAILURE_THRESHOLD: "2",
      CIRCUIT_COOLDOWN_BASE_MS: "100000",
    }),
    { provider, goldRegistry },
  );

  await app.refresh(); // failure 1
  await app.refresh(); // failure 2 -> breaker opens
  const callsAtOpen = provider.calls;
  await app.refresh(); // breaker open -> skipped, no provider call
  assert.equal(provider.calls, callsAtOpen, "open circuit must not call the provider");
  assert.equal(app.store.circuitOpenUntil > Date.now(), true);
});

test("stale-while-revalidate: a failed refresh keeps serving the last good snapshot as degraded", async () => {
  const provider = flakyProvider();
  const app = createApp(loadConfig({ PROVIDER_MODE: "live", SHORTLIST: "divine" }), { provider, goldRegistry });

  await app.refresh(); // success -> snapshot cached
  provider.fail = true;
  await app.refresh(); // failure -> keep snapshot, mark degraded

  const r = mockRes();
  await app.handler(req("GET", "/api/opportunities"), r);
  assert.equal(r.statusCode, 200, "stale snapshot is still served");
  assert.equal(r.body.degraded, true);
  assert.equal(r.body.fresh, false);
  assert.ok(r.body.lastError);
});

test("no snapshot + provider failure -> 503 error, nothing fabricated", async () => {
  const provider = flakyProvider();
  provider.fail = true;
  const app = createApp(loadConfig({ PROVIDER_MODE: "live", SHORTLIST: "divine" }), { provider, goldRegistry });
  await app.refresh(); // fails, no books

  const r = mockRes();
  await app.handler(req("GET", "/api/opportunities"), r);
  assert.equal(r.statusCode, 503);
  assert.equal(r.body.state, "error");
  assert.equal(r.body.opportunities, undefined);
  assert.ok(r.body.error);
});

test("/api/status exposes scheduler + circuit observability (no secrets)", async () => {
  const app = createApp(loadConfig({ ADMIN_TOKEN: "secret" }), {
    provider: createFixtureProvider(),
    goldRegistry,
  });
  await app.refresh();
  const r = mockRes();
  await app.handler(req("GET", "/api/status"), r);
  assert.equal(r.statusCode, 200);
  assert.ok(r.body.refreshCount >= 1);
  assert.equal(r.body.circuitOpen, false);
  assert.equal("adminToken" in r.body, false);
  assert.equal(JSON.stringify(r.body).includes("secret"), false);
});

// --- codex A3 review fixes ---

test("admin refresh reports failure honestly (502, refreshed:false)", async () => {
  const provider = flakyProvider();
  provider.fail = true;
  const app = createApp(loadConfig({ PROVIDER_MODE: "live", SHORTLIST: "divine", ADMIN_TOKEN: "secret" }), {
    provider,
    goldRegistry,
  });
  const r = mockRes();
  await app.handler(req("POST", "/admin/refresh", { headers: { "x-admin-token": "secret" } }), r);
  assert.equal(r.statusCode, 502);
  assert.equal(r.body.refreshed, false);
  assert.ok(r.body.error);
});

test("a wrong-length admin token is rejected (constant-time compare path)", async () => {
  const app = createApp(loadConfig({ PROVIDER_MODE: "live", SHORTLIST: "divine", ADMIN_TOKEN: "secret" }), {
    provider: flakyProvider(),
    goldRegistry,
  });
  const r = mockRes();
  await app.handler(req("POST", "/admin/refresh", { headers: { "x-admin-token": "x" } }), r);
  assert.equal(r.statusCode, 403);
});

test("outward error messages are scrubbed (no upstream detail leaks)", async () => {
  const provider = {
    mode: "live",
    label: "leaky",
    async fetchExchange() {
      throw new Error("connect ECONNREFUSED https://secret.internal/api?token=abc");
    },
  };
  const app = createApp(loadConfig({ PROVIDER_MODE: "live", SHORTLIST: "divine" }), { provider, goldRegistry });
  await app.refresh();
  const r = mockRes();
  await app.handler(req("GET", "/api/opportunities"), r);
  assert.equal(r.statusCode, 503);
  const body = JSON.stringify(r.body);
  assert.equal(body.includes("secret.internal"), false);
  assert.equal(body.includes("ECONNREFUSED"), false);
});

test("refresh is atomic: a late-anchor failure commits nothing (no partial books)", async () => {
  let calls = 0;
  const provider = {
    mode: "live",
    label: "partial",
    async fetchExchange() {
      calls++;
      if (calls >= 4) throw new Error("late failure"); // fail on the 2nd anchor's leg
      return { id: "x", result: {} };
    },
  };
  const app = createApp(loadConfig({ PROVIDER_MODE: "live", SHORTLIST: "divine", ANCHORS: "exalted,divine" }), {
    provider,
    goldRegistry,
  });
  await app.refresh();
  assert.ok(calls >= 4);
  // The first anchor was fully fetched into the staging map but never committed
  // because a later anchor failed -> no snapshot at all (503), not partial data.
  const r = mockRes();
  await app.handler(req("GET", "/api/opportunities?anchor=exalted"), r);
  assert.equal(r.statusCode, 503);
  assert.equal(r.body.state, "error");
});

test("status.degraded is true when a refresh fails but cached books remain", async () => {
  const provider = flakyProvider();
  const app = createApp(loadConfig({ PROVIDER_MODE: "live", SHORTLIST: "divine" }), { provider, goldRegistry });
  await app.refresh(); // ok -> books cached
  provider.fail = true;
  await app.refresh(); // fail -> degraded, books retained
  const r = mockRes();
  await app.handler(req("GET", "/api/status"), r);
  assert.equal(r.body.degraded, true);
  assert.equal(r.body.hasSnapshot, true);
});

test("security config is range-validated (no zero/negative protection windows)", () => {
  const c = loadConfig({
    API_RATE_LIMIT_PER_MIN: "0",
    API_RATE_WINDOW_MS: "-5",
    CIRCUIT_COOLDOWN_BASE_MS: "30000",
    CIRCUIT_COOLDOWN_MAX_MS: "10",
  });
  assert.ok(c.apiRateLimitPerMin >= 1);
  assert.ok(c.apiRateWindowMs >= 1000);
  assert.ok(c.circuitCooldownMaxMs >= c.circuitCooldownBaseMs); // max forced >= base
});
