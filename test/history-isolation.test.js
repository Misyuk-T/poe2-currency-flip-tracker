import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createHistoryStore, historyFilePath, scopeKey } from "../src/server/history-store.js";

const fixtureScope = { mode: "fixture", game: "poe2", realm: "poe2", league: "Runes of Aldur", anchor: "exalted" };
const liveScope = { ...fixtureScope, mode: "live" };

test("Fix 10: fixture and live history resolve to DIFFERENT files (no collision)", () => {
  assert.notEqual(scopeKey(fixtureScope), scopeKey(liveScope));
  assert.notEqual(historyFilePath("/tmp/data", fixtureScope), historyFilePath("/tmp/data", liveScope));
});

test("Fix 3: switching league/anchor isolates history files", () => {
  const a = historyFilePath("/d", { ...liveScope, league: "Standard" });
  const b = historyFilePath("/d", { ...liveScope, league: "Hardcore" });
  const c = historyFilePath("/d", { ...liveScope, anchor: "divine" });
  assert.equal(new Set([a, b, c]).size, 3);
});

test("Fix 3: fixture-mode points are always stamped synthetic and persisted to the fixture file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hist-"));
  const store = createHistoryStore({ dir, scope: fixtureScope });
  await store.record([{ t: 1, target: "divine", spreadPct: 5 }]);
  const raw = await readFile(store.filePath, "utf8");
  const point = JSON.parse(raw.trim());
  assert.equal(point.mode, "fixture");
  assert.equal(point.synthetic, true);
});

test("Fix 3: a live store NEVER loads synthetic/foreign points (legacy migration is safe)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hist-"));
  const live = createHistoryStore({ dir, scope: liveScope });
  // Hand-write a file at the live path mixing legacy-unscoped + synthetic + real live points.
  await writeFile(
    live.filePath,
    [
      JSON.stringify({ t: 1, target: "divine", spreadPct: 1 }), // legacy, no provenance -> dropped
      JSON.stringify({ t: 2, target: "divine", spreadPct: 2, mode: "fixture", synthetic: true }), // synthetic -> dropped
      JSON.stringify({ t: 3, target: "divine", spreadPct: 3, mode: "live" }), // real live -> kept
    ].join("\n") + "\n",
  );
  await live.load();
  const pts = live.get("divine");
  assert.equal(pts.length, 1);
  assert.equal(pts[0].t, 3);
});

test("Fix 3: live store refuses to record synthetic points (strips the flag)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hist-"));
  const live = createHistoryStore({ dir, scope: liveScope });
  await live.record([{ t: 9, target: "divine", spreadPct: 7, synthetic: true }]);
  const pt = live.get("divine")[0];
  assert.equal(pt.mode, "live");
  assert.notEqual(pt.synthetic, true);
});
