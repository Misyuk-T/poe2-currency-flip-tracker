import test from "node:test";
import assert from "node:assert/strict";

import { backoffMs, readRateLimit } from "../src/providers/rate-limit.js";

// Shape taken from GGG's documented headers: a rules list, then a policy and a
// state header per rule, each a comma-separated list of colon-joined groups.
const headers = (extra = {}) =>
  new Headers({
    "x-rate-limit-rules": "Ip",
    "x-rate-limit-ip": "10:1:60,300:300:1800",
    "x-rate-limit-ip-state": "3:1:0,25:300:0",
    ...extra,
  });

test("reads the declared limit alongside the current hit count", () => {
  const { states, shouldBackOff } = readRateLimit(headers());
  assert.equal(states.length, 2);
  assert.deepEqual(
    states.map((s) => ({ hits: s.hits, limit: s.limit, period: s.periodSeconds })),
    [
      { hits: 3, limit: 10, period: 1 },
      { hits: 25, limit: 300, period: 300 },
    ],
  );
  assert.equal(shouldBackOff, false);
});

test("an active penalty in the state header means back off", () => {
  const { penaltySeconds, shouldBackOff } = readRateLimit(
    headers({ "x-rate-limit-ip-state": "10:1:12,25:300:0" }),
  );
  assert.equal(penaltySeconds, 12);
  assert.equal(shouldBackOff, true);
});

test("the longest remaining penalty across rules wins", () => {
  const { penaltySeconds } = readRateLimit(
    headers({ "x-rate-limit-ip-state": "10:1:5,300:300:90" }),
  );
  assert.equal(penaltySeconds, 90);
});

test("Retry-After is authoritative even when a penalty is also present", () => {
  // The server telling us a number beats anything we infer from the state.
  const { retryAfterSeconds, penaltySeconds } = readRateLimit(
    headers({ "retry-after": "7", "x-rate-limit-ip-state": "10:1:90,25:300:0" }),
  );
  assert.equal(retryAfterSeconds, 7);
  assert.equal(penaltySeconds, 7);
});

test("backoffMs converts to milliseconds and caps runaway values", () => {
  assert.equal(backoffMs(headers({ "retry-after": "3" })), 3000);
  assert.equal(backoffMs(headers({ "retry-after": "99999" })), 60_000);
  assert.equal(backoffMs(headers({ "retry-after": "99999" }), { maxMs: 5000 }), 5000);
});

test("no penalty means no wait at all", () => {
  assert.equal(backoffMs(headers()), 0);
});

test("missing or malformed headers degrade to no back-off rather than throwing", () => {
  assert.equal(backoffMs(new Headers()), 0);
  assert.equal(backoffMs(undefined), 0);
  assert.equal(backoffMs(new Headers({ "retry-after": "not-a-number" })), 0);
  const garbled = readRateLimit(new Headers({ "x-rate-limit-rules": "Ip", "x-rate-limit-ip-state": "junk" }));
  assert.equal(garbled.shouldBackOff, false);
});

test("plain objects work as well as Headers, case-insensitively", () => {
  const { penaltySeconds } = readRateLimit({
    "X-Rate-Limit-Rules": "Ip",
    "X-Rate-Limit-Ip-State": "10:1:30",
  });
  assert.equal(penaltySeconds, 30);
});
