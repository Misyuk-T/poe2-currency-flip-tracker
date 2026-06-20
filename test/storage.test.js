import { test } from "node:test";
import assert from "node:assert/strict";

import { createStorage } from "../src/storage/storage-provider.js";
import { createSupabaseStorage } from "../src/storage/supabase-storage.js";

const scope = { mode: "live", game: "poe2", realm: "poe2", league: "L" };
const pt = (target, t) => ({
  t,
  target,
  bestEntry: 200,
  bestExit: 210,
  spreadPct: 5,
  depthEntry: 10,
  depthExit: 10,
});

test("local storage records and reads market points per anchor (isolated)", async () => {
  const storage = createStorage({ storageMode: "local" }, { dir: null }); // dir null -> in-memory
  await storage.init(scope, ["exalted", "divine"]);

  await storage.recordSuccessfulCycle({
    cycleId: "c1",
    startedAt: 1,
    durationMs: 5,
    anchors: [
      { anchor: "exalted", fetchedAt: 1000, marketPoints: [pt("divine", 1000)] },
      { anchor: "divine", fetchedAt: 1000, marketPoints: [pt("exalted", 1000)] },
    ],
  });

  assert.equal(storage.series("exalted").get("divine").length, 1);
  assert.equal(storage.series("divine").get("exalted").length, 1);
  // an anchor only sees its own targets
  assert.deepEqual(Object.keys(storage.series("exalted").all()), ["divine"]);
  assert.deepEqual(Object.keys(storage.series("divine").all()), ["exalted"]);
  await storage.close();
});

test("seedSynthetic fills the buffer in memory and stamps fixture provenance", async () => {
  const storage = createStorage({ storageMode: "local" }, { dir: null });
  await storage.init({ ...scope, mode: "fixture" }, ["exalted"]);
  storage.seedSynthetic("exalted", [pt("divine", 1)]);
  const pts = storage.series("exalted").get("divine");
  assert.equal(pts.length, 1);
  assert.equal(pts[0].synthetic, true);
});

test("supabase mode falls back to local when DATABASE_URL is missing", () => {
  const s = createStorage({ storageMode: "supabase", databaseUrl: null }, { dir: null });
  assert.equal(s.mode, "local");
});

test("an unknown anchor returns an empty series", async () => {
  const storage = createStorage({ storageMode: "local" }, { dir: null });
  await storage.init(scope, ["exalted"]);
  assert.deepEqual(storage.series("mirror").all(), {});
  assert.deepEqual(storage.series("mirror").get("divine"), []);
});

test("supabase storage is best-effort: a DB outage updates memory and never throws", async () => {
  // Injected connector whose every operation rejects (DB completely down).
  const downSql = () => Promise.reject(new Error("db down"));
  downSql.begin = async () => {
    throw new Error("db down");
  };
  downSql.end = async () => {};

  const storage = createSupabaseStorage({ databaseUrl: "x" }, { connect: async () => downSql });
  await storage.init(scope, ["exalted"]); // load fails internally, store still created

  // recordSuccessfulCycle must update the in-memory buffer despite the DB error.
  await storage.recordSuccessfulCycle({
    cycleId: "c1",
    startedAt: 1,
    durationMs: 2,
    anchors: [{ anchor: "exalted", fetchedAt: 1000, marketPoints: [pt("divine", 1000)] }],
  });
  assert.equal(storage.series("exalted").get("divine").length, 1);

  // recordFailedCycle must also swallow the DB error.
  await storage.recordFailedCycle({
    cycleId: "c2",
    startedAt: 1,
    durationMs: 2,
    anchors: ["exalted"],
    error: { code: "x", message: "y" },
  });
  await storage.close();
  assert.ok(true);
});

test("recordFailedCycle is a no-op for local storage (no throw)", async () => {
  const storage = createStorage({ storageMode: "local" }, { dir: null });
  await storage.init(scope, ["exalted"]);
  await storage.recordFailedCycle({
    cycleId: "c2",
    startedAt: 1,
    durationMs: 2,
    anchors: ["exalted"],
    error: { code: "x", message: "y" },
  });
  assert.ok(true);
});
