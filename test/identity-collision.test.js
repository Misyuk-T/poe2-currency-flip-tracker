import test from "node:test";
import assert from "node:assert/strict";

import { chooseShortIdOwner, tradedIdsFromDigest } from "../src/domain/identity-collision.js";

const UNCUT = "Metadata/Items/Gems/SkillGemUncut1";
const UNCUT_QUEST = "Metadata/Items/Gems/SkillGemUncutQuest1";

test("a single candidate owns the short id outright", () => {
  assert.equal(chooseShortIdOwner([UNCUT], new Set()), UNCUT);
});

test("the traded twin wins over the untraded one, whatever the order", () => {
  const traded = new Set([UNCUT]);
  assert.equal(chooseShortIdOwner([UNCUT_QUEST, UNCUT], traded), UNCUT);
  assert.equal(chooseShortIdOwner([UNCUT, UNCUT_QUEST], traded), UNCUT);
});

test("the quest copy can still win if it is the one being traded", () => {
  // No hardcoded "Quest is never real" rule — the exchange decides, so a league
  // that starts trading the other copy is handled by rebuilding, not by a patch.
  assert.equal(chooseShortIdOwner([UNCUT, UNCUT_QUEST], new Set([UNCUT_QUEST])), UNCUT_QUEST);
});

test("with no digest the choice is stable, not first-seen", () => {
  const a = chooseShortIdOwner([UNCUT_QUEST, UNCUT], new Set());
  const b = chooseShortIdOwner([UNCUT, UNCUT_QUEST], new Set());
  assert.equal(a, b, "RePoE key order must not change who owns the short id");
});

test("several traded candidates still resolve deterministically", () => {
  const ids = ["Metadata/B", "Metadata/A"];
  const traded = new Set(ids);
  assert.equal(chooseShortIdOwner(ids, traded), "Metadata/A");
});

test("no candidates yields no owner", () => {
  assert.equal(chooseShortIdOwner([], new Set()), null);
  assert.equal(chooseShortIdOwner(undefined, new Set()), null);
});

test("traded ids come from both sides of every market pair", () => {
  const ids = tradedIdsFromDigest({
    markets: [
      { market_pair: ["Metadata/A", "Metadata/B"] },
      { market_pair: ["Metadata/B", "Metadata/C"] },
      { market_pair: [] },
      {},
    ],
  });
  assert.deepEqual([...ids].sort(), ["Metadata/A", "Metadata/B", "Metadata/C"]);
});

test("an empty or malformed digest yields an empty set rather than throwing", () => {
  assert.equal(tradedIdsFromDigest(null).size, 0);
  assert.equal(tradedIdsFromDigest({ markets: [] }).size, 0);
});
