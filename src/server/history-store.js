/**
 * Snapshot history store.
 *
 * Records lightweight, *market-only* (constraint-independent) points over time
 * so the UI can chart price/spread/depth trends and the horizon signal can be
 * derived from REAL, provider-matched observations. No database (per the brief):
 * an in-memory ring buffer per target, optionally persisted to a JSONL file and
 * reloaded on startup. Disk I/O is best-effort and never crashes the server.
 *
 * Isolation (critical — history must never mix across sources/markets):
 *   - the on-disk file name is derived from a SCOPE
 *     (mode + game + realm + league + anchor), so fixture and live history can
 *     never share a file, and switching league/anchor/mode starts a clean file;
 *   - every persisted point carries provenance: `mode` and, for fixture mode,
 *     `synthetic: true`. On load, points whose provenance does not match the
 *     store's scope are dropped. This makes legacy, unscoped files safe to
 *     ignore and guarantees synthetic fixture data can never contaminate a live
 *     analysis even if a file were somehow shared.
 *
 * @typedef {Object} HistoryScope
 * @property {"fixture"|"live"} mode
 * @property {string} game
 * @property {string} realm
 * @property {string} league
 * @property {string} anchor
 *
 * @typedef {Object} HistoryPoint
 * @property {number} t            epoch ms
 * @property {string} target
 * @property {number|null} bestEntry
 * @property {number|null} bestExit
 * @property {number|null} spreadPct
 * @property {number|null} depthEntry
 * @property {number|null} depthExit
 * @property {"fixture"|"live"} [mode]  provenance stamped at record time
 * @property {boolean} [synthetic]      true for ALL fixture-mode points
 */

import { appendFile, readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Filesystem-safe slug for a scope component. */
function slug(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "none";
}

/** Stable, collision-resistant scope key (used in the filename). */
export function scopeKey(scope) {
  return [scope.mode, scope.game, scope.realm, scope.league, scope.anchor].map(slug).join("__");
}

/** Absolute path to the history file for a given scope inside `dir`. */
export function historyFilePath(dir, scope) {
  return join(dir, `history-${scopeKey(scope)}.jsonl`);
}

/**
 * @param {{ dir?: string|null, scope?: HistoryScope|null, filePath?: string|null, maxPointsPerTarget?: number }} [opts]
 */
export function createHistoryStore({ dir = null, scope = null, filePath = null, maxPointsPerTarget = 600 } = {}) {
  const mode = scope?.mode ?? null;
  const resolvedPath = filePath ?? (dir && scope ? historyFilePath(dir, scope) : null);

  /** @type {Map<string, HistoryPoint[]>} */
  const series = new Map();
  let writeQueue = Promise.resolve();

  /** Stamp provenance and enforce the fixture<->synthetic invariant. */
  function stamp(point) {
    if (!mode) return point;
    const next = { ...point, mode };
    if (mode === "fixture") next.synthetic = true;
    else delete next.synthetic;
    return next;
  }

  /**
   * A point is acceptable for this store iff its provenance matches the scope.
   * Anything else (foreign mode, missing provenance from a legacy unscoped file,
   * or synthetic data in a live store) is dropped — safely ignoring legacy data
   * and guaranteeing fixture/live never contaminate each other.
   */
  function matchesScope(point) {
    if (!mode) return true; // unscoped store (tests) accepts anything
    if (mode === "live") return point.mode === "live" && point.synthetic !== true;
    if (mode === "fixture") return point.synthetic === true;
    return true;
  }

  function pushLocal(point) {
    const arr = series.get(point.target) ?? [];
    arr.push(point);
    arr.sort((a, b) => a.t - b.t);
    while (arr.length > maxPointsPerTarget) arr.shift();
    series.set(point.target, arr);
  }

  async function persist(lines) {
    if (!resolvedPath) return;
    writeQueue = writeQueue
      .then(async () => {
        await mkdir(dirname(resolvedPath), { recursive: true });
        await appendFile(resolvedPath, lines.map((p) => JSON.stringify(p)).join("\n") + "\n");
      })
      .catch(() => {}); // best-effort
    return writeQueue;
  }

  return {
    get filePath() {
      return resolvedPath;
    },
    get scope() {
      return scope;
    },

    /** Load persisted history from disk (no-op if missing/unreadable). */
    async load() {
      if (!resolvedPath) return;
      try {
        const raw = await readFile(resolvedPath, "utf8");
        for (const line of raw.split("\n")) {
          if (!line.trim()) continue;
          try {
            const point = JSON.parse(line);
            if (matchesScope(point)) pushLocal(point); // drop legacy/foreign provenance
          } catch {
            /* skip corrupt line */
          }
        }
      } catch {
        /* no file yet */
      }
    },

    /** Seed in-memory points WITHOUT writing to disk (e.g. synthetic backfill). */
    seed(points) {
      for (const p of points) pushLocal(stamp(p));
    },

    /** Record real points (in-memory + persisted), stamped with provenance. */
    record(points) {
      const list = (Array.isArray(points) ? points : [points]).map(stamp);
      for (const p of list) pushLocal(p);
      return persist(list);
    },

    get(target) {
      return series.get(target) ?? [];
    },

    all() {
      const out = {};
      for (const [k, v] of series) out[k] = v;
      return out;
    },

    /** Rewrite the file from current in-memory state (compaction). */
    async compact() {
      if (!resolvedPath) return;
      const lines = [];
      for (const arr of series.values()) for (const p of arr) lines.push(JSON.stringify(p));
      try {
        await mkdir(dirname(resolvedPath), { recursive: true });
        await writeFile(resolvedPath, lines.join("\n") + (lines.length ? "\n" : ""));
      } catch {
        /* best-effort */
      }
    },
  };
}

/**
 * Derive a market-only history point for one target from its sorted books.
 */
export function pointFromBooks({ target, t, entryBook, exitBook, bookDepth }) {
  const bestEntry = entryBook[0]?.price ?? null;
  const bestExit = exitBook[0]?.price ?? null;
  return {
    t,
    target,
    bestEntry,
    bestExit,
    spreadPct: bestEntry && bestExit ? ((bestExit - bestEntry) / bestEntry) * 100 : null,
    depthEntry: bookDepth(entryBook),
    depthExit: bookDepth(exitBook),
  };
}
