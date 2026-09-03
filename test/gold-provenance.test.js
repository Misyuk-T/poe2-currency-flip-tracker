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

import { describeGoldProvenance } from "../src/domain/gold-costs.js";
import { POE2_GOLD_COSTS } from "../src/data/gold-costs-poe2.js";
import { RADAR_PAYLOAD_VERSION, isCompatibleRadarSnapshot } from "../src/domain/radar-snapshot.js";
import { catalogWithGold, getRadar } from "../apps/web/lib/radar-backend.js";
import { goldSourceNote, goldTooltip } from "../apps/web/lib/gold-provenance.js";

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

  // A stored row is newer than the committed table, so the date the payload
  // reports is the day THAT value was observed upstream.
  const database = describeGoldProvenance({
    records: [...POE2_GOLD_COSTS.slice(0, 3), storedRow()],
    storedRows: 1,
  });
  assert.deepEqual(
    [database.source, database.effectiveFrom, database.storedRows],
    ["database", "2026-09-03", 1],
  );
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

  // 3. Stored rows applied on top — reported as such, with the newer date.
  const merged = catalogWithGold(ctxFor(), [storedRow()]);
  assert.deepEqual(
    [merged.gold.source, merged.gold.effectiveFrom, merged.gold.storedRows],
    ["database", "2026-09-03", 1],
  );
  assert.equal(merged.gold.rows, POE2_GOLD_COSTS.length, "a stored row replaces a committed one, it does not add to it");
  assert.equal(merged.catalogById.get("chaos").goldPerUnit, 4242, "provenance did not change the number");

  // A row the stored table never saw keeps its committed cost, and the payload
  // still reports "database" because the table did contribute.
  const divine = POE2_GOLD_COSTS.find((record) => record.itemId === "divine");
  assert.equal(merged.catalogById.get("divine").goldPerUnit, divine.goldPerUnit);

  // Rows scoped away (wrong game) are not stored rows.
  const otherGame = catalogWithGold(ctxFor(), [storedRow({ game: "poe1" })]);
  assert.equal(otherGame.gold.source, "committed");
});

test("the tooltip says 'placeholder' only when the number is one", () => {
  const row = { _goldPerFlip: 1040, _profitPer100k: 12.3 };

  const placeholder = goldTooltip(row, { source: "placeholder", goldPerUnit: 600 });
  assert.match(placeholder, /Gold cost per 1-unit flip ≈ 1,040 \(flat placeholder, not per-currency data\)\./);

  const committed = goldTooltip(row, { source: "committed", effectiveFrom: "2026-07-25" });
  assert.match(
    committed,
    /Gold cost per 1-unit flip ≈ 1,040 — the in-game exchange fee to receive one unit, observed 2026-07-25\./,
  );
  assert.doesNotMatch(committed, /placeholder/i);

  const database = goldTooltip(row, { source: "database", effectiveFrom: "2026-09-03" });
  assert.match(database, /observed 2026-09-03\./);
  assert.doesNotMatch(database, /placeholder/i);

  // No provenance in the payload (a snapshot stored before this key existed, or
  // PoE1): state the number, claim nothing about it.
  const silent = goldTooltip(row, null);
  assert.match(silent, /Gold cost per 1-unit flip ≈ 1,040\./);
  assert.doesNotMatch(silent, /placeholder|observed/i);
  assert.equal(goldSourceNote(undefined), "");

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
    assert.match(
      goldTooltip({ _goldPerFlip: 1240 }, radar.body.gold),
      /flat placeholder, not per-currency data/,
    );
  } finally {
    delete process.env.RADAR_FIXTURE_FALLBACK;
  }
});
