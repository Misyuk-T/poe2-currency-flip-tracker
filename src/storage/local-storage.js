/**
 * Local StorageProvider: in-memory ring buffers + per-anchor JSONL persistence.
 * Reuses the scope-isolated history store. Zero dependencies. Default storage.
 */

import { createHistoryStore } from "../server/history-store.js";

const EMPTY_SERIES = { all: () => ({}), get: () => [] };

export function createLocalStorage(_config, { dir = null } = {}) {
  /** @type {Map<string, ReturnType<typeof createHistoryStore>>} */
  const stores = new Map();
  let scope = null;

  return {
    mode: "local",

    async init(s, anchors) {
      scope = s;
      for (const anchor of anchors) {
        const store = createHistoryStore({ dir, scope: { ...scope, anchor } });
        await store.load();
        stores.set(anchor, store);
      }
    },

    series(anchor) {
      return stores.get(anchor) ?? EMPTY_SERIES;
    },

    seedSynthetic(anchor, points) {
      stores.get(anchor)?.seed(points);
    },

    async recordSuccessfulCycle({ anchors }) {
      // store.record() updates the in-memory buffer AND appends JSONL.
      for (const { anchor, marketPoints } of anchors) {
        await stores.get(anchor)?.record(marketPoints);
      }
    },

    async recordFailedCycle() {
      // Local mode keeps no run-metadata table; the failure is already in the
      // server logs. Nothing durable to write.
    },

    async close() {},
  };
}
