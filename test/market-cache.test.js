import test from "node:test";
import assert from "node:assert/strict";

import { fetchJsonCached, peekCachedJson } from "../apps/web/lib/market.js";

test("fetchJsonCached deduplicates in-flight reads and reuses the session result", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({ calls });
  };

  try {
    const url = "/api/test-cache-dedup";
    const [first, second] = await Promise.all([
      fetchJsonCached(url, { ttlMs: 60_000 }),
      fetchJsonCached(url, { ttlMs: 60_000 }),
    ]);

    assert.equal(calls, 1);
    assert.deepEqual(first, { calls: 1 });
    assert.deepEqual(second, { calls: 1 });
    assert.deepEqual(peekCachedJson(url, { ttlMs: 60_000 }), { calls: 1 });
    assert.deepEqual(await fetchJsonCached(url, { ttlMs: 60_000 }), { calls: 1 });
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
