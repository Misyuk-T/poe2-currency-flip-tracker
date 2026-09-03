/**
 * The production case, end to end: with the flat demo stand-in switched off, the
 * radar payload is priced from the committed, sourced table — and says so,
 * instead of shipping a real number under the word "placeholder".
 *
 * Its own file because the read context (and therefore the gold registry) is
 * resolved once per process.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { getRadar } from "../apps/web/lib/radar-backend.js";
import { goldTooltip } from "../apps/web/lib/gold-provenance.js";

test("a non-placeholder build reports the committed table, not a placeholder", async () => {
  // Read lazily by the read context, which is resolved on the first getRadar
  // call — so setting it here, before that call, is what live mode does.
  process.env.GOLD_PLACEHOLDER_PER_UNIT = "off";
  delete process.env.DATABASE_URL;
  process.env.RADAR_FIXTURE_FALLBACK = "1";
  try {
    const radar = await getRadar(new URLSearchParams("anchor=exalted"));
    assert.equal(radar.status, 200);
    assert.deepEqual(
      [radar.body.gold.source, radar.body.gold.effectiveFrom, radar.body.gold.storedRows],
      ["committed", "2026-07-25", 0],
    );

    const priced = radar.body.rows.find((row) => row?.gold?.status === "supported");
    assert.ok(priced, "the fixture radar priced at least one row from the committed table");
    // Each row is dated by its own record, and the anchor leg carries its own.
    assert.equal(priced.gold.effectiveFrom, "2026-07-25");
    assert.equal(priced.anchorGoldEffectiveFrom, "2026-07-25");
    assert.equal(radar.body.goldAnchorEffectiveFrom, "2026-07-25");

    const tooltip = goldTooltip(
      { _goldPerFlip: 4600, _goldObservedFrom: priced.gold.effectiveFrom },
      radar.body.gold,
    );
    assert.match(tooltip, /both legs of the round trip; gold costs observed 2026-07-25\./);
    assert.doesNotMatch(tooltip, /placeholder/i);
    assert.doesNotMatch(tooltip, /fee to receive one unit/i);
  } finally {
    delete process.env.RADAR_FIXTURE_FALLBACK;
  }
});
