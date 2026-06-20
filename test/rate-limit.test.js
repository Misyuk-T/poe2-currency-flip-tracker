import { test } from "node:test";
import assert from "node:assert/strict";

import { parseRateLimitPolicy, createRateLimiter } from "../src/providers/rate-limit.js";

test("parses GGG rate-limit policy header", () => {
  const rules = parseRateLimitPolicy("5:15:60,10:90:300,30:300:1800");
  assert.equal(rules.length, 3);
  assert.deepEqual(rules[0], { hits: 5, windowSec: 15, penaltySec: 60 });
  assert.equal(parseRateLimitPolicy("").length, 0);
  assert.equal(parseRateLimitPolicy(null).length, 0);
});

test("limiter throttles once the safe bucket fraction is exhausted", () => {
  let clock = 0;
  const limiter = createRateLimiter({ now: () => clock, safetyFraction: 0.6, jitterMs: 0 });
  limiter.updateFromHeaders({ "x-rate-limit-ip": "5:15:60" }); // budget = floor(5*0.6)=3 per 15s
  for (let i = 0; i < 3; i++) {
    assert.equal(limiter.nextDelayMs(), 0);
    limiter.record();
  }
  // 4th within window must wait until the first ages out (~15s)
  assert.ok(limiter.nextDelayMs() > 0);
});

test("429 penalty is respected", () => {
  let clock = 1_000_000;
  const limiter = createRateLimiter({ now: () => clock, jitterMs: 0 });
  limiter.penalize(30);
  assert.ok(limiter.nextDelayMs() >= 30000);
});
