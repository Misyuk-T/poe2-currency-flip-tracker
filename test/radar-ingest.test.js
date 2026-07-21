import test from "node:test";
import assert from "node:assert/strict";

import { ingestFixtureIncrement, ingestFixtures, ingestLive } from "../src/server/radar-ingest.js";

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

test("ingestFixtures synthesizes labelled-synthetic hourly history", async () => {
  const repo = mockRepo();
  const out = await ingestFixtures({ repo, league: "Runes of Aldur", anchors: ["exalted"], now: 1_750_000_000_000 });
  assert.equal(out.mode, "fixture");
  assert.equal(out.digests, 168);
  assert.equal(repo.recorded.length, 168);
  assert.equal(out.inserted, repo.recorded.reduce((sum, d) => sum + d.candles.length, 0));
  // Every fixture candle is clearly flagged synthetic with an honest source.
  for (const digest of repo.recorded) {
    assert.ok(digest.candles.length > 0);
    assert.ok(digest.candles.every((c) => c.synthetic === true && c.source === "fixture-cxapi"));
  }
});

test("ingestFixtureIncrement jumps a stale cursor to the latest completed fixture digest", async () => {
  const now = 1_750_000_000_000;
  const latestCompletedHour = Math.floor(now / 3600_000) * 3600 - 3600;
  const cursor = latestCompletedHour - 2 * 3600;
  const repo = mockRepo({ state: { cursor, lastDigestId: cursor - 3600 } });
  const phases = [];
  const out = await ingestFixtureIncrement({
    repo,
    league: "Runes of Aldur",
    anchors: ["exalted"],
    now,
    maxDigests: 1,
    trace: (phase) => phases.push(phase),
  });
  assert.equal(out.digests, 1);
  assert.equal(repo.recorded.length, 1);
  assert.equal(repo.recorded[0].digestId, latestCompletedHour);
  assert.equal(repo.recorded[0].nextChangeId, latestCompletedHour + 3600);
  assert.equal(out.remainingDigests, 0);
  assert.ok(phases.includes("fixture.state.read.start"));
  assert.ok(phases.includes("fixture.write.end"));
});

test("ingestFixtureIncrement is a no-op when the latest completed hour is already persisted", async () => {
  const latestCompletedHour = Math.floor(1_750_000_000_000 / 3600_000) * 3600 - 3600;
  const repo = mockRepo({ state: { cursor: latestCompletedHour + 3600, lastDigestId: latestCompletedHour } });
  const out = await ingestFixtureIncrement({
    repo,
    league: "Runes of Aldur",
    anchors: ["exalted"],
    now: 1_750_000_000_000,
  });
  assert.equal(out.digests, 0);
  assert.equal(repo.recorded.length, 0);
  assert.equal(out.remainingDigests, 0);
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
