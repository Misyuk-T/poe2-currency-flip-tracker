import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_ICON_CANDIDATES,
  categoryIconMap,
  iconCandidatesForCategory,
  iconCandidatesForRow,
} from "../apps/web/lib/icon-candidates.js";

const row = (targetIcon, category) => ({ targetIcon, category });

test("a row whose own icon is broken still gets siblings from its category", () => {
  // "Soul Core" style case: three members, the first one's art path 404s.
  const rows = [row("broken-a.png", "Soul Core"), row("works-b.png", "Soul Core")];
  const chain = iconCandidatesForRow(rows[0], categoryIconMap(rows));
  assert.deepEqual(chain, ["broken-a.png", "works-b.png"]);
});

test("the row's own icon always comes first so a working one is never overridden", () => {
  const rows = [row("mine.png", "Runes"), row("sibling.png", "Runes")];
  assert.equal(iconCandidatesForRow(rows[0], categoryIconMap(rows))[0], "mine.png");
});

test("a curated category glyph is the last resort, after every live sibling", () => {
  const rows = [row("a.png", "Soul Core")];
  const chain = iconCandidatesForRow(rows[0], categoryIconMap(rows), { "Soul Core": "soul-core-of-tacati" });
  assert.deepEqual(chain, ["a.png", "soul-core-of-tacati"]);
});

test("duplicates are collapsed so the same failing URL is never retried", () => {
  const rows = [row("same.png", "Vaal")];
  const chain = iconCandidatesForRow(rows[0], categoryIconMap(rows), { Vaal: "same.png" });
  assert.deepEqual(chain, ["same.png"]);
});

test("a brand-new category from a future league needs no code change", () => {
  // Nothing about "Whatever New Class" is known to the app in advance.
  const rows = [row(null, "Whatever New Class"), row("live.png", "Whatever New Class")];
  const chain = iconCandidatesForRow(rows[0], categoryIconMap(rows));
  assert.deepEqual(chain, ["live.png"]);
});

test("a row with no icon and no usable sibling yields an empty chain, not a guess", () => {
  const rows = [row(null, "Mystery")];
  assert.deepEqual(iconCandidatesForRow(rows[0], categoryIconMap(rows)), []);
});

test("candidates per category are capped so a big category can't bloat every row", () => {
  const rows = Array.from({ length: 20 }, (_, i) => row(`icon-${i}.png`, "Runes"));
  assert.equal(categoryIconMap(rows).get("Runes").length, MAX_ICON_CANDIDATES);
});

test("rows missing a category fall into one shared bucket rather than being dropped", () => {
  const rows = [row("a.png", null), row("b.png", undefined)];
  assert.deepEqual(categoryIconMap(rows).get("Other"), ["a.png", "b.png"]);
});

test("a sidebar chip prefers its curated glyph, then falls back to live members", () => {
  const rows = [row("member.png", "Currency")];
  const chain = iconCandidatesForCategory("Currency", categoryIconMap(rows), { Currency: "exalted" });
  assert.deepEqual(chain, ["exalted", "member.png"]);
});

test("a sidebar chip for an uncurated category still gets its members' icons", () => {
  const rows = [row("member.png", "Soul Core")];
  assert.deepEqual(iconCandidatesForCategory("Soul Core", categoryIconMap(rows)), ["member.png"]);
});
