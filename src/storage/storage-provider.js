/**
 * StorageProvider — the durability seam (mirrors the MarketProvider pattern).
 *
 * Two implementations, chosen by config.storageMode:
 *   - "local"    : in-memory ring buffers + per-anchor JSONL files (zero-dep,
 *                  the default; used for offline dev and the whole test suite).
 *   - "supabase" : in-memory read buffers + durable Postgres (snapshot_runs +
 *                  market_points) via postgres.js, loaded once at startup.
 *
 * Reads always hit the in-memory buffer (fast, no per-request DB round trip).
 * Durable writes are BEST-EFFORT: the in-memory series is updated first, so a
 * storage outage never degrades serving or fails a refresh.
 *
 * Interface:
 *   async init(scope, anchors)            scope = { mode, game, realm, league }
 *   series(anchor) -> { all(), get(target) }   sync in-memory read
 *   seedSynthetic(anchor, points)         in-memory only (fixture backfill)
 *   async recordSuccessfulCycle({ cycleId, startedAt, durationMs, anchors:[{anchor, fetchedAt, marketPoints}] })
 *   async recordFailedCycle({ cycleId, startedAt, durationMs, anchors:[anchorId], error })
 *   async close()
 */

import { createLocalStorage } from "./local-storage.js";
import { createSupabaseStorage } from "./supabase-storage.js";

export const EMPTY_SERIES = { all: () => ({}), get: () => [] };

/**
 * @param {import("../server/config.js").AppConfig} config
 * @param {{ dir?: string }} [opts]
 */
export function createStorage(config, opts = {}) {
  if (config.storageMode === "supabase" && config.databaseUrl) {
    return createSupabaseStorage(config, opts);
  }
  return createLocalStorage(config, opts);
}
