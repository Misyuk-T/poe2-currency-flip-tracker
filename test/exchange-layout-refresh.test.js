import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchHtml,
  isTransientFetchError,
  runLayoutRefresh,
} from "../scripts/build-exchange-layouts.mjs";

test("fetchHtml retries transient HTTP failures with exponential backoff", async () => {
  const statuses = [503, 502, 200];
  const delays = [];
  const retries = [];

  const html = await fetchHtml("https://example.test/layout", {
    baseDelayMs: 25,
    fetchImpl: async () => new Response("layout", { status: statuses.shift() }),
    onRetry: (retry) => retries.push(retry),
    sleep: async (delayMs) => delays.push(delayMs),
  });

  assert.equal(html, "layout");
  assert.deepEqual(delays, [25, 50]);
  assert.deepEqual(retries.map(({ attempt, nextAttempt }) => [attempt, nextAttempt]), [[1, 2], [2, 3]]);
});

test("fetchHtml honors Retry-After while capping the delay", async () => {
  const delays = [];
  let calls = 0;

  await fetchHtml("https://example.test/layout", {
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return new Response("busy", { status: 503, headers: { "retry-after": "60" } });
      return new Response("layout");
    },
    maxDelayMs: 5_000,
    onRetry: () => {},
    sleep: async (delayMs) => delays.push(delayMs),
  });

  assert.deepEqual(delays, [5_000]);
});

test("fetchHtml reports exhausted transient failures", async () => {
  const delays = [];
  let calls = 0;

  await assert.rejects(
    fetchHtml("https://example.test/layout", {
      attempts: 3,
      baseDelayMs: 10,
      fetchImpl: async () => {
        calls += 1;
        return new Response("unavailable", { status: 503 });
      },
      onRetry: () => {},
      sleep: async (delayMs) => delays.push(delayMs),
    }),
    (error) => error.status === 503 && error.attempts === 3 && isTransientFetchError(error),
  );

  assert.equal(calls, 3);
  assert.deepEqual(delays, [10, 20]);
});

test("fetchHtml does not retry permanent HTTP failures", async () => {
  let calls = 0;

  await assert.rejects(
    fetchHtml("https://example.test/layout", {
      fetchImpl: async () => {
        calls += 1;
        return new Response("missing", { status: 404 });
      },
      sleep: async () => assert.fail("permanent failures must not sleep"),
    }),
    (error) => error.status === 404 && !isTransientFetchError(error),
  );

  assert.equal(calls, 1);
});

test("scheduled refreshes keep stale snapshots after transient exhaustion", async () => {
  const error = new TypeError("fetch failed");
  error.attempts = 4;
  const warnings = [];

  const result = await runLayoutRefresh({
    allowStaleOnTransientFailure: true,
    fetchHtmlImpl: async () => { throw error; },
    targets: [{ game: "poe1", sourceUrl: "https://example.test/layout" }],
    warn: (message) => warnings.push(message),
  });

  assert.deepEqual(result.staleTargets, ["poe1"]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /keeping the checked-in snapshot/);
  assert.match(warnings[0], /after 4 attempts/);
});

test("manual refreshes still fail after transient exhaustion", async () => {
  const error = new TypeError("fetch failed");

  await assert.rejects(
    runLayoutRefresh({
      allowStaleOnTransientFailure: false,
      fetchHtmlImpl: async () => { throw error; },
      targets: [{ game: "poe1", sourceUrl: "https://example.test/layout" }],
    }),
    error,
  );
});

test("scheduled refreshes do not hide permanent source failures", async () => {
  const error = new Error("https://example.test/layout: HTTP 404");
  error.status = 404;
  error.transient = false;

  await assert.rejects(
    runLayoutRefresh({
      allowStaleOnTransientFailure: true,
      fetchHtmlImpl: async () => { throw error; },
      targets: [{ game: "poe1", sourceUrl: "https://example.test/layout" }],
    }),
    error,
  );
});
