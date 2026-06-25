import test from "node:test";
import assert from "node:assert/strict";

import { ingestFixtures, ingestLive } from "../src/server/radar-ingest.js";

function mockRepo({ state = { cursor: null, lastDigestId: null } } = {}) {
  const recorded = [];
  return {
    recorded,
    async readCxapiState() {
      return state;
    },
    async recordCxDigest(digest) {
      recorded.push(digest);
      return digest.candles.length; // pretend every candle is newly inserted
    },
  };
}

test("ingestFixtures synthesizes 30 labelled-synthetic hourly digests", async () => {
  const repo = mockRepo();
  const out = await ingestFixtures({ repo, league: "Runes of Aldur", anchors: ["exalted"], now: 1_750_000_000_000 });
  assert.equal(out.mode, "fixture");
  assert.equal(out.digests, 30);
  assert.equal(repo.recorded.length, 30);
  assert.equal(out.inserted, repo.recorded.reduce((sum, d) => sum + d.candles.length, 0));
  // Every fixture candle is clearly flagged synthetic with an honest source.
  for (const digest of repo.recorded) {
    assert.ok(digest.candles.length > 0);
    assert.ok(digest.candles.every((c) => c.synthetic === true && c.source === "fixture-cxapi"));
  }
});

test("ingestLive fetches the latest digest when there is no cursor, then stops", async () => {
  const payload = (id) => ({
    next_change_id: id + 3600,
    markets: [
      {
        league: "L",
        market_id: "divine|exalted",
        lowest_ratio: { divine: 1, exalted: 200 },
        highest_ratio: { divine: 1, exalted: 220 },
        volume_traded: { divine: 5, exalted: 1000 },
      },
    ],
  });
  let calls = 0;
  const provider = {
    configured: true,
    async fetchDigest({ id }) {
      calls += 1;
      const digestId = id == null ? 1000 : id;
      return { digestId, payload: payload(digestId) };
    },
  };
  const repo = mockRepo({ state: { cursor: null } });
  const out = await ingestLive({ repo, provider, league: "L", startId: null, maxDigests: 5 });
  assert.equal(out.configured, true);
  assert.equal(out.digests, 1); // id null => latest digest, then break (no future requests)
  assert.equal(calls, 1);
  assert.ok(out.inserted >= 1);
});

test("ingestLive is a no-op when the provider is not configured", async () => {
  const out = await ingestLive({ repo: mockRepo(), provider: { configured: false }, league: "L" });
  assert.equal(out.mode, "live");
  assert.equal(out.configured, false);
  assert.equal(out.digests, 0);
  assert.equal(out.inserted, 0);
});

test("isCronAuthorized validates the bearer against CRON_SECRET (constant-time)", async () => {
  delete process.env.CRON_SECRET;
  const { isCronAuthorized, cronConfigured } = await import("../apps/web/lib/radar-backend.js");

  assert.equal(cronConfigured(), false);
  assert.equal(isCronAuthorized("Bearer anything"), false); // secret unset => deny

  process.env.CRON_SECRET = "s3cr3t-cron-token-value";
  assert.equal(cronConfigured(), true);
  assert.equal(isCronAuthorized("Bearer s3cr3t-cron-token-value"), true);
  assert.equal(isCronAuthorized("Bearer wrong-token-value-here"), false);
  assert.equal(isCronAuthorized("s3cr3t-cron-token-value"), false); // missing "Bearer "
  assert.equal(isCronAuthorized(null), false);
  delete process.env.CRON_SECRET;
});
