import test from "node:test";
import assert from "node:assert/strict";
import { createHourlyStore } from "../src/storage/hourly-store.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const candle = { league: "L", pairId: "a|b", completedHour: 1000 };

test("hourly storage is idempotent and persists cursor in memory", async () => {
  const s = createHourlyStore();
  assert.equal(await s.recordDigest({ digestId: 1, nextChangeId: 2, candles: [candle] }), 1);
  assert.equal(await s.recordDigest({ digestId: 1, nextChangeId: 2, candles: [candle] }), 0);
  assert.equal(s.get("a|b").length, 1);
  assert.deepEqual(s.state(), { cursor: 2, lastDigestId: 1, pairCount: 1, candleCount: 1 });
});

test("hourly JSONL reload restores candles and the cxapi cursor", async () => {
  const dir = await mkdtemp(join(tmpdir(), "poe-hourly-"));
  const filePath = join(dir, "hourly.jsonl");
  try {
    const first = createHourlyStore({ filePath });
    await first.recordDigest({ digestId: 100, nextChangeId: 200, candles: [candle] });
    const reloaded = createHourlyStore({ filePath });
    await reloaded.load();
    assert.equal(reloaded.state().cursor, 200);
    assert.equal(reloaded.state().lastDigestId, 100);
    assert.equal(reloaded.state().candleCount, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
