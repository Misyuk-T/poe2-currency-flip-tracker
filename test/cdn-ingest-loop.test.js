import test from "node:test";
import assert from "node:assert/strict";
import { ingestLive } from "../src/server/radar-ingest.js";
import { createGggCdnCxapiProvider } from "../src/providers/ggg-cdn-cxapi-provider.js";

// Drive the REAL CDN provider through ingestLive over a simulated stream to prove
// the cursor walks forward hour-by-hour and stops cleanly at the live-edge
// terminal (next_change_id === requested id, empty markets) — the exact CDN
// semantics probed live, which the OAuth "no-id is latest" model does NOT share.

const T0 = 1784613600; // a real captured hour boundary

function mockRepo(cursor = null) {
  const recorded = [];
  return {
    recorded,
    async readCxapiState() {
      return { cursor, lastDigestId: null };
    },
    async recordCxDigest(digest) {
      recorded.push(digest);
      return digest.candles.length;
    },
  };
}

// A CDN stream: hours T0 and T0+3600 are complete (have markets); T0+7200 is the
// in-progress hour and returns next_change_id === its own id with no markets.
function streamFetch(url) {
  const id = Number(url.split("/").pop());
  const complete = {
    league: "L",
    market_id: "divine|exalted",
    lowest_ratio: { divine: 1, exalted: 200 },
    highest_ratio: { divine: 1, exalted: 220 },
    volume_traded: { divine: 5, exalted: 1000 },
  };
  if (id === T0 || id === T0 + 3600) {
    return { ok: true, status: 200, async json() { return { next_change_id: id + 3600, markets: [complete] }; } };
  }
  // terminal: in-progress hour
  return { ok: true, status: 200, async json() { return { next_change_id: id, markets: [] }; } };
}

test("CDN provider walks the cursor forward and stops at the live-edge terminal", async () => {
  const provider = createGggCdnCxapiProvider({
    poeRealm: "poe2", cxapiTimeoutMs: 1000, userAgent: "agent", _cxFetch: async (url) => streamFetch(url),
  });
  const repo = mockRepo(T0);
  const out = await ingestLive({ repo, provider, league: "L", maxDigests: 10 });

  // Requested T0, T0+3600, T0+7200(terminal) -> 3 digests, then break.
  assert.equal(out.digests, 3);
  assert.deepEqual(repo.recorded.map((d) => d.digestId), [T0, T0 + 3600, T0 + 7200]);
  // digestId is the REQUESTED hour throughout (never next-3600).
  assert.equal(repo.recorded[2].digestId, T0 + 7200);
  // Terminal digest carries no candles but is still recorded (cursor advances).
  assert.equal(repo.recorded[2].candles.length, 0);
  // Completed hours produced real candles at the integer-ratio price 220/1.. etc.
  assert.ok(repo.recorded[0].candles.length > 0);
  assert.equal(out.lastDigestId, T0 + 7200);
});
