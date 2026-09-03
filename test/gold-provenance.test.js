/**
 * Gold provenance: the payload must say WHICH of the three gold sources produced
 * its numbers, and the UI must only use the word "placeholder" for the one that
 * genuinely is one.
 *
 * The bug this pins: production served real, sourced per-currency gold costs
 * (committed table + `gold_costs` rows) while the tooltip called every one of
 * them a placeholder. Under-claiming is still mislabelling.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { describeGoldProvenance, roundTripGold } from "../src/domain/gold-costs.js";
import { POE2_GOLD_COSTS } from "../src/data/gold-costs-poe2.js";
import { RADAR_PAYLOAD_VERSION, isCompatibleRadarSnapshot } from "../src/domain/radar-snapshot.js";
import { catalogWithGold, getRadar } from "../apps/web/lib/radar-backend.js";
import { goldSourceNote, goldTooltip, olderDate } from "../apps/web/lib/gold-provenance.js";

const CONFIG = {
  poeGame: "poe2",
  poeRealm: "poe2",
  league: "Runes of Aldur",
  providerMode: "live",
  cxapiStreams: [{ game: "poe2", realm: "poe2" }],
};

const ctxFor = (extra = {}) => ({
  config: CONFIG,
  catalog: {
    items: [
      { id: "chaos", name: "Chaos Orb", category: "Currency" },
      { id: "divine", name: "Divine Orb", category: "Currency" },
    ],
  },
  goldPlaceholder: false,
  goldPlaceholderPerUnit: null,
  catalogManifest: [],
  catalogById: new Map(),
  ...extra,
});

const storedRow = (extra = {}) => ({
  game: "poe2",
  itemId: "chaos",
  displayName: "Chaos Orb",
  goldPerUnit: 4242,
  effectiveFrom: "2026-09-03",
  patchOrVersion: "db-observed-2026-09-03",
  source: "gold_costs table",
  ...extra,
});

test("describeGoldProvenance: the flat stand-in is the only thing called a placeholder", () => {
  assert.deepEqual(describeGoldProvenance({ placeholder: true, goldPerUnit: 600 }), {
    source: "placeholder",
    goldPerUnit: 600,
    effectiveFrom: null,
    patchOrVersion: null,
    rows: 0,
    storedRows: 0,
  });

  const committed = describeGoldProvenance({ records: POE2_GOLD_COSTS });
  assert.deepEqual(
    [committed.source, committed.effectiveFrom, committed.rows, committed.storedRows],
    ["committed", "2026-07-25", POE2_GOLD_COSTS.length, 0],
  );
  assert.equal(committed.patchOrVersion, "0.3-observed-2026-07-25");
});

test("the payload-wide date is a floor, so a partial refresh cannot age-wash a stale row", () => {
  // upsertGoldCosts rewrites only the rows it matched, so a refresh that matched
  // one item leaves the rest at their older date. Reporting the NEWEST date here
  // would stamp 2026-09-03 on values observed six weeks earlier.
  const partial = describeGoldProvenance({
    records: [...POE2_GOLD_COSTS.slice(0, 3), storedRow()],
    storedRows: 1,
  });
  assert.deepEqual(
    [partial.source, partial.effectiveFrom, partial.storedRows],
    ["database", "2026-07-25", 1],
    "the oldest number still in the payload sets the floor",
  );

  // A full refresh has nothing older left to report.
  const full = describeGoldProvenance({
    records: [storedRow(), storedRow({ itemId: "divine" })],
    storedRows: 2,
  });
  assert.deepEqual([full.source, full.effectiveFrom], ["database", "2026-09-03"]);
});

test("each row is dated by its own observation, not by the payload's newest", () => {
  // The floor is what a row falls back to; a row that carries its own date uses
  // it, and a row whose two legs disagree shows the older of the two.
  const stale = { _goldPerFlip: 4600, _goldObservedFrom: "2026-07-25" };
  const fresh = { _goldPerFlip: 4600, _goldObservedFrom: "2026-09-03" };
  const payloadFloor = { source: "database", effectiveFrom: "2026-07-25" };
  assert.match(goldTooltip(stale, payloadFloor), /gold costs observed 2026-07-25\./);
  assert.match(goldTooltip(fresh, payloadFloor), /gold costs observed 2026-09-03\./);
  assert.match(
    goldTooltip({ _goldPerFlip: 4600 }, payloadFloor),
    /gold costs observed 2026-07-25\./,
    "no per-row date falls back to the payload floor",
  );

  assert.equal(olderDate("2026-09-03", "2026-07-25"), "2026-07-25");
  assert.equal(olderDate("2026-09-03", null), "2026-09-03");
  assert.equal(olderDate(null, undefined), null);
});

test("the payload carries the source that actually won the merge", () => {
  // 1. Flat demo placeholder — never "improved" with stored gold, and says so.
  const placeholder = catalogWithGold(
    ctxFor({ goldPlaceholder: true, goldPlaceholderPerUnit: 600 }),
    [storedRow()],
  );
  assert.deepEqual(
    [placeholder.gold.source, placeholder.gold.goldPerUnit],
    ["placeholder", 600],
  );

  // 2. Committed table only: no stored rows to layer on.
  const committed = catalogWithGold(ctxFor(), []);
  assert.deepEqual(
    [committed.gold.source, committed.gold.effectiveFrom, committed.gold.storedRows],
    ["committed", "2026-07-25", 0],
  );

  // 3. Stored rows applied on top — reported as such.
  const merged = catalogWithGold(ctxFor(), [storedRow()]);
  assert.deepEqual(
    [merged.gold.source, merged.gold.effectiveFrom, merged.gold.storedRows],
    ["database", "2026-07-25", 1],
  );
  // `rows` counts merged gold records, not catalog items: this stored id already
  // existed in the committed table, so it replaced a row rather than adding one.
  // A stored id the catalog does not list would still be counted here.
  assert.equal(merged.gold.rows, POE2_GOLD_COSTS.length);
  assert.equal(merged.catalogById.get("chaos").goldPerUnit, 4242, "provenance did not change the number");
  assert.equal(
    merged.catalogById.get("chaos").goldEffectiveFrom,
    "2026-09-03",
    "the refreshed item is dated by its own observation",
  );

  // A row the stored table never saw keeps its committed cost AND its own older
  // date, and the payload still reports "database" because the table contributed.
  const divine = POE2_GOLD_COSTS.find((record) => record.itemId === "divine");
  assert.equal(merged.catalogById.get("divine").goldPerUnit, divine.goldPerUnit);
  assert.equal(merged.catalogById.get("divine").goldEffectiveFrom, "2026-07-25");

  // Rows scoped away (wrong game) are not stored rows.
  const otherGame = catalogWithGold(ctxFor(), [storedRow({ game: "poe1" })]);
  assert.equal(otherGame.gold.source, "committed");
});

test("the tooltip describes the figure roundTripGold actually produced", () => {
  // The figure is TWO legs: gold on the 1 target unit bought, plus gold on the
  // anchor received when selling it back. Describing it as the fee to receive
  // one unit understates it several-fold — this pins the arithmetic to the
  // wording so it cannot be silently reworded back.
  const goldPerTarget = 1000;
  const goldPerAnchor = 120;
  const high = 30;
  const { entryGold, exitGold, totalGold } = roundTripGold({
    receivedTarget: 1,
    receivedAnchorOnExit: high,
    goldPerTarget,
    goldPerAnchor,
  });
  assert.deepEqual([entryGold, exitGold, totalGold], [1000, 3600, 4600]);
  assert.ok(totalGold > goldPerTarget * 2, "a per-unit fee would be nowhere near this number");

  const text = goldTooltip(
    { _goldPerFlip: totalGold, _goldObservedFrom: "2026-07-25" },
    { source: "committed", effectiveFrom: "2026-07-25" },
  );
  assert.match(text, /Gold cost per 1-unit flip ≈ 4,600 — both legs of the round trip/);
  assert.doesNotMatch(text, /fee to receive one unit/i);
  assert.doesNotMatch(text, /per unit|per-unit/i);
});

test("the tooltip says 'placeholder' only when the number is one", () => {
  const row = { _goldPerFlip: 4600, _profitPer100k: 12.3, _goldObservedFrom: "2026-07-25" };

  const placeholder = goldTooltip({ ...row, _goldObservedFrom: null }, { source: "placeholder", goldPerUnit: 600 });
  assert.match(
    placeholder,
    /Gold cost per 1-unit flip ≈ 4,600 — both legs of the round trip, from a flat placeholder, not per-currency data\./,
  );

  const committed = goldTooltip(row, { source: "committed", effectiveFrom: "2026-07-25" });
  assert.match(
    committed,
    /Gold cost per 1-unit flip ≈ 4,600 — both legs of the round trip; gold costs observed 2026-07-25\./,
  );
  assert.doesNotMatch(committed, /placeholder/i);

  const database = goldTooltip(
    { ...row, _goldObservedFrom: "2026-09-03" },
    { source: "database", effectiveFrom: "2026-09-03" },
  );
  assert.match(database, /gold costs observed 2026-09-03\./);
  assert.doesNotMatch(database, /placeholder/i);

  // No provenance in the payload (a snapshot stored before these keys existed,
  // or PoE1): say what the figure is, claim nothing about where it came from.
  const silent = goldTooltip(row, null);
  assert.match(silent, /Gold cost per 1-unit flip ≈ 4,600 — both legs of the round trip\./);
  assert.doesNotMatch(silent, /placeholder|observed/i);
  assert.equal(goldSourceNote(undefined), "");
  // A sourced payload with no date anywhere states the shape and stops.
  assert.equal(goldSourceNote({ source: "committed", effectiveFrom: null }), "");

  // The spread caveat and the per-100k line are untouched by any of this.
  for (const text of [placeholder, committed, database, silent]) {
    assert.match(text, /size of the opportunity, not a completed round trip/);
    assert.match(text, /≈ 12\.3 exalted profit per 100,000 gold of trade tax\./);
  }

  // Nothing to say when the flip cost is unknown.
  assert.doesNotMatch(goldTooltip({}, { source: "committed", effectiveFrom: "2026-07-25" }), /Gold cost per/);
});

test("provenance is additive: a snapshot without it is still compatible", () => {
  // Deliberately NOT a payload-version bump. `gold` adds a label, it does not
  // change what any existing key means, so a stored snapshot from before this
  // deploy stays semantically correct — and the tooltip's no-provenance wording
  // makes no claim about where its numbers came from.
  assert.equal(RADAR_PAYLOAD_VERSION, 6);
  assert.equal(
    isCompatibleRadarSnapshot({ payload: { payloadVersion: 6 }, refreshedAt: Date.now() }),
    true,
  );
});

test("the demo radar labels its gold a placeholder end to end", async () => {
  // Fixture mode is the one build that really does use a flat 600 on every item.
  delete process.env.DATABASE_URL;
  process.env.RADAR_FIXTURE_FALLBACK = "1";
  try {
    const radar = await getRadar(new URLSearchParams("anchor=exalted"));
    assert.equal(radar.status, 200);
    assert.equal(radar.body.gold.source, "placeholder");
    assert.equal(radar.body.gold.goldPerUnit, 600);
    // The flat registry observed nothing, so no row can carry a date to show.
    const priced = radar.body.rows.find((row) => row?.gold?.status === "supported");
    assert.equal(priced.gold.effectiveFrom, null);
    assert.match(
      goldTooltip({ _goldPerFlip: 4600 }, radar.body.gold),
      /both legs of the round trip, from a flat placeholder, not per-currency data\./,
    );
  } finally {
    delete process.env.RADAR_FIXTURE_FALLBACK;
  }
});
