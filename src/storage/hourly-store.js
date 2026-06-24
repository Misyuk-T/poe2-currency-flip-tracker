import { appendFile, readFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export function createHourlyStore({ filePath = null, maxHoursPerPair = 24 * 30 } = {}) {
  const byPair = new Map();
  const keys = new Set();
  let cursor = null;
  let lastDigestId = null;

  function add(candle) {
    const key = `${candle.league}|${candle.pairId}|${candle.completedHour}`;
    if (keys.has(key)) return false;
    keys.add(key);
    const arr = byPair.get(candle.pairId) ?? [];
    arr.push(candle);
    arr.sort((a, b) => a.completedHour - b.completedHour);
    while (arr.length > maxHoursPerPair) {
      const removed = arr.shift();
      keys.delete(`${removed.league}|${removed.pairId}|${removed.completedHour}`);
    }
    byPair.set(candle.pairId, arr);
    return true;
  }

  async function persist(event) {
    if (!filePath) return;
    await mkdir(dirname(filePath), { recursive: true });
    await appendFile(filePath, JSON.stringify(event) + "\n");
  }

  return {
    seed(candles, state = {}) {
      for (const candle of candles ?? []) add(candle);
      cursor = state.cursor ?? cursor;
      lastDigestId = state.lastDigestId ?? lastDigestId;
    },
    async load() {
      if (!filePath) return;
      try {
        const text = await readFile(filePath, "utf8");
        for (const line of text.split("\n")) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === "digest") {
            for (const candle of event.candles ?? []) add(candle);
            cursor = event.nextChangeId ?? cursor;
            lastDigestId = event.digestId ?? lastDigestId;
          }
        }
      } catch (err) {
        if (err.code !== "ENOENT") throw err;
      }
    },
    async recordDigest({ digestId, nextChangeId, candles }) {
      let inserted = 0;
      for (const candle of candles) if (add(candle)) inserted++;
      cursor = nextChangeId ?? cursor;
      lastDigestId = digestId ?? lastDigestId;
      await persist({ type: "digest", digestId, nextChangeId, candles });
      return inserted;
    },
    all() {
      return Object.fromEntries([...byPair].map(([id, rows]) => [id, [...rows]]));
    },
    get(pairId) {
      return [...(byPair.get(pairId) ?? [])];
    },
    state() {
      return { cursor, lastDigestId, pairCount: byPair.size, candleCount: keys.size };
    },
  };
}
