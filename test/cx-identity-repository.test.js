import test from "node:test";
import assert from "node:assert/strict";
import { createRadarRepository } from "../src/storage/radar-repository.js";

const scope = { game: "poe2", realm: "poe2", league: "Runes of Aldur", mode: "live" };

/**
 * A postgres.js stand-in for the non-transactional writers: usable as a tagged
 * template AND as `sql(rows)`, which is the multi-row VALUES fragment. Captures
 * every statement so the schema contract can be asserted without a database.
 */
function fakeSql(result = []) {
  const templateCalls = [];
  const sql = (first, ...values) => {
    const isTagged = Array.isArray(first) && Object.prototype.hasOwnProperty.call(first, "raw");
    if (!isTagged) return { __fragmentRows: first };
    templateCalls.push({ text: first.join(" ? "), values });
    return Promise.resolve(result);
  };
  return { sql, templateCalls };
}

const fragmentOf = (call) => call.values.find((value) => value?.__fragmentRows)?.__fragmentRows;

test("upsertCxIdentity writes multi-row batches, not one statement per id", async () => {
  const { sql, templateCalls } = fakeSql();
  const repo = createRadarRepository({ sql, scope });
  const rows = Array.from({ length: 120 }, (_, i) => ({
    metadataId: `Metadata/Items/Currency/Tail${i}`,
    name: `Tail ${i}`,
    icon: i % 2 ? `https://example.test/${i}.png` : null,
    category: null,
    subcategory: null,
    shortId: null,
    source: i % 2 ? "repoe-catalog" : "humanized",
  }));
  const now = new Date("2026-09-02T04:20:00Z");

  const written = await repo.upsertCxIdentity(rows, { game: "poe2", now, batchSize: 50 });
  assert.equal(written, 120);
  // 120 ids at 50 per batch: three statements, not 120 round trips. At the job's
  // 200-id cap that is the difference between four round trips and two hundred,
  // inside a 60s route budget.
  assert.equal(templateCalls.length, 3);

  const batches = templateCalls.map(fragmentOf);
  assert.deepEqual(batches.map((batch) => batch.length), [50, 50, 20]);
  // Every row carries the same column set in the same order, so postgres.js can
  // emit one VALUES list per batch.
  for (const batch of batches) {
    for (const row of batch) {
      assert.deepEqual(Object.keys(row), [
        "game", "metadata_id", "name", "icon", "category", "subcategory",
        "short_id", "source", "resolved_at", "updated_at",
      ]);
      assert.equal(row.game, "poe2");
      assert.equal(row.updated_at, now);
    }
  }
  // resolved_at moves only for a row that actually carries an upstream answer;
  // updated_at always moves, so the retry window ages placeholders.
  assert.equal(batches[0][0].resolved_at, null);
  assert.equal(batches[0][1].resolved_at, now);

  // The never-degrade contract lives in the SQL. Assert it is still there.
  for (const column of ["name", "icon", "category", "subcategory", "short_id"]) {
    assert.match(
      templateCalls[0].text,
      new RegExp(`${column} = coalesce\\(excluded\\.${column}, cx_identity\\.${column}\\)`),
      `${column} must never be degraded by a later, poorer answer`,
    );
  }
  assert.match(templateCalls[0].text, /on conflict \(game, metadata_id\) do update set/);
});

test("upsertCxIdentity ignores unusable rows and writes nothing for an empty batch", async () => {
  const { sql, templateCalls } = fakeSql();
  const repo = createRadarRepository({ sql, scope });
  assert.equal(await repo.upsertCxIdentity([], { game: "poe2" }), 0);
  assert.equal(await repo.upsertCxIdentity([{ name: "no id" }, { metadataId: "" }], { game: "poe2" }), 0);
  assert.equal(templateCalls.length, 0);
});

test("listObservedCurrencyIds splits stored pair ids back into their two currencies", async () => {
  const { sql, templateCalls } = fakeSql([
    { pair_id: "chaos|exalted" },
    { pair_id: "Metadata/Items/Currency/CurrencyTail|exalted" },
    { pair_id: "chaos|divine" },
    { pair_id: "" },
  ]);
  const repo = createRadarRepository({ sql, scope });
  const ids = await repo.listObservedCurrencyIds({ days: 7 });
  assert.deepEqual(ids, ["chaos", "exalted", "Metadata/Items/Currency/CurrencyTail", "divine"]);
  // Reads pair_id (in the primary key) rather than the heap-only currency
  // columns — see the method's comment.
  assert.match(templateCalls[0].text, /select distinct pair_id/);
  assert.match(templateCalls[0].text, /from hourly_market_candles/);
});
