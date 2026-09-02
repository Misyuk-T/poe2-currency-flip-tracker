import test from "node:test";
import assert from "node:assert/strict";

// No database configured, so nothing this route reaches can touch a live one.
delete process.env.DATABASE_URL;
delete process.env.CRON_SECRET;

const route = await import("../apps/web/app/api/cron/identity/route.js");

const request = (headers = {}, method = "POST") => ({
  method,
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
});

test("the identity cron route is a Node function with room for two upstream fetches", () => {
  assert.equal(route.runtime, "nodejs");
  assert.equal(route.dynamic, "force-dynamic");
  // Matches timeout_milliseconds in supabase/migrations/010_cx_identity.sql.
  assert.equal(route.maxDuration, 60);
  assert.equal(route.GET, route.POST, "pg_net posts; a human may GET the same handler");
});

test("with CRON_SECRET unset the route is disabled rather than open", async () => {
  const response = await route.POST(request({ authorization: "Bearer anything" }));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "cron-disabled");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("the route rejects a missing, malformed or wrong bearer token", async () => {
  process.env.CRON_SECRET = "s3cr3t-cron-token-value";
  try {
    for (const headers of [{}, { authorization: "s3cr3t-cron-token-value" }, { authorization: "Bearer wrong-token-value-here" }]) {
      const response = await route.POST(request(headers));
      assert.equal(response.status, 401, JSON.stringify(headers));
      assert.equal((await response.json()).error.code, "unauthorized");
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
  } finally {
    delete process.env.CRON_SECRET;
  }
});

test("an authorized call runs the job and reports per-game results", async () => {
  process.env.CRON_SECRET = "s3cr3t-cron-token-value";
  try {
    const response = await route.POST(request({ authorization: "Bearer s3cr3t-cron-token-value" }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.ok(Array.isArray(body.games));
    // No DATABASE_URL and no configured cxapi stream: every enabled game (none,
    // here) is reported honestly rather than the route pretending it worked.
    for (const game of body.games) assert.equal(game.written, 0);
  } finally {
    delete process.env.CRON_SECRET;
  }
});
