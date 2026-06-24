import test from "node:test";
import assert from "node:assert/strict";

import { buildRadarResponse } from "../src/domain/radar-payload.js";

const manifest = [
  { id: "divine", name: "Divine Orb", category: "Currency", subcategory: "Currency", catalogOrder: 1, status: "supported", goldPerUnit: 100 },
  { id: "chaos", name: "Chaos Orb", category: "Currency", subcategory: "Currency", catalogOrder: 2, status: "supported", goldPerUnit: 50 },
  { id: "vaal", name: "Vaal Orb", category: "Currency", subcategory: "Currency", catalogOrder: 3, status: "unknown-gold-cost", goldPerUnit: null },
];
const catalogById = new Map(manifest.map((item) => [item.id, item]));

test("buildRadarResponse merges radar rows with catalog metadata and display units", () => {
  const radarRows = [
    { target: "divine", reference: 1, referenceKind: "range-midpoint-proxy", status: "ok", activityScore: 50, arbitrageScore: 10 },
    { target: "chaos", reference: 0.01, referenceKind: "range-midpoint-proxy", status: "ok", activityScore: 20, arbitrageScore: 30 },
  ];
  const out = buildRadarResponse({
    radarRows,
    hotlistEntries: [{ id: "divine", reason: "activity" }],
    catalogManifest: manifest,
    catalogById,
    anchor: "exalted",
    source: { sourceMode: "fixture" },
    now: 1_700_000_000_000,
  });

  assert.equal(out.anchor, "exalted");
  assert.equal(out.trackedCount, 2);
  assert.equal(out.catalogCount, 3); // 2 tracked + vaal (no trades)
  assert.equal(out.generatedAt, new Date(1_700_000_000_000).toISOString());
  assert.deepEqual(out.source, { sourceMode: "fixture" });

  // anchor=exalted => divine.reference IS divineInExalted.
  assert.equal(out.units.divineInExalted, 1);

  const divine = out.rows.find((row) => row.target === "divine");
  assert.equal(divine.category, "Currency");
  assert.deepEqual(divine.gold, { status: "supported", goldPerUnit: 100 });
  assert.deepEqual(divine.hotlist, { id: "divine", reason: "activity" });
  assert.equal(divine.displayPrice.unit, "divine");
  assert.ok(Math.abs(divine.displayPrice.value - 1) < 1e-9);

  const chaos = out.rows.find((row) => row.target === "chaos");
  assert.equal(chaos.hotlist, null);
  assert.equal(chaos.displayPrice.unit, "exalted"); // cheap markets shown in exalted
  assert.ok(Math.abs(chaos.displayPrice.value - 0.01) < 1e-9);
});

test("buildRadarResponse lists catalog items with no trades as no-trades-this-hour", () => {
  const out = buildRadarResponse({
    radarRows: [{ target: "divine", reference: 1, status: "ok", activityScore: 1, arbitrageScore: 1 }],
    catalogManifest: manifest,
    catalogById,
    anchor: "exalted",
    now: 0,
  });
  const vaal = out.rows.find((row) => row.target === "vaal");
  assert.equal(vaal.status, "no-trades-this-hour");
  assert.equal(vaal.reference, null);
  assert.equal(vaal.activityScore, null);
  assert.deepEqual(vaal.sparkline24h, []);
  assert.deepEqual(vaal.displayPrice, { value: null, unit: null });
  assert.deepEqual(vaal.gold, { status: "unknown-gold-cost", goldPerUnit: null });
});

test("buildRadarResponse marks radar rows missing from the catalog as unknown-catalog-item", () => {
  const out = buildRadarResponse({
    radarRows: [{ target: "mystery", reference: 5, status: "ok", activityScore: 1, arbitrageScore: 1 }],
    catalogManifest: manifest,
    catalogById,
    anchor: "exalted",
    now: 0,
  });
  const mystery = out.rows.find((row) => row.target === "mystery");
  assert.deepEqual(mystery.gold, { status: "unknown-catalog-item", goldPerUnit: null });
  // The anchor row is never duplicated, but every other catalog item still shows.
  assert.equal(out.trackedCount, 1);
  assert.equal(out.catalogCount, 1 + manifest.length); // mystery + all 3 catalog no-trade rows
});
