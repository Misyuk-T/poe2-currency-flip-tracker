import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// No database configured, so nothing this route reaches can touch a live one.
delete process.env.DATABASE_URL;
delete process.env.CRON_SECRET;

const route = await import("../apps/web/app/api/cron/data-refresh/route.js");

const request = (headers = {}, method = "POST") => ({
  method,
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
});

test("the data-refresh cron route is a Node function sized to the migration's timeout", () => {
  assert.equal(route.runtime, "nodejs");
  assert.equal(route.dynamic, "force-dynamic");
  // Matches timeout_milliseconds in supabase/migrations/011_layout_gold.sql.
  assert.equal(route.maxDuration, 60);
  assert.equal(route.GET, route.POST, "pg_net posts; a human may GET the same handler");
});

test("migration 011 schedules this exact route with the same budget and secret", () => {
  const sql = readFileSync(new URL("../supabase/migrations/011_layout_gold.sql", import.meta.url), "utf8");
  assert.match(sql, /cron\.schedule\(\s*'data-refresh-daily',\s*'40 4 \* \* \*'/);
  assert.match(sql, /url := 'https:\/\/exileradar\.com\/api\/cron\/data-refresh'/);
  assert.match(sql, new RegExp(`timeout_milliseconds := ${route.maxDuration * 1000}`));
  // The same Vault-held secret as migrations 004/008/010 — not a second one.
  assert.match(sql, /vault\.decrypted_secrets where name = 'radar_cron_secret'/);
  // Additive only, and no browser-facing grant.
  assert.match(sql, /create table if not exists public\.exchange_layout/);
  assert.match(sql, /create table if not exists public\.gold_costs/);
  for (const table of ["exchange_layout", "gold_costs"]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(sql, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`));
  }
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

test("an authorized call runs both jobs and reports per-task results", async () => {
  process.env.CRON_SECRET = "s3cr3t-cron-token-value";
  try {
    const response = await route.POST(request({ authorization: "Bearer s3cr3t-cron-token-value" }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.ok(Array.isArray(body.tasks));
    // No DATABASE_URL and no configured cxapi stream: every enabled game (none,
    // here) is reported honestly rather than the route pretending it worked.
    for (const task of body.tasks) assert.equal(task.written, 0);
  } finally {
    delete process.env.CRON_SECRET;
  }
});
