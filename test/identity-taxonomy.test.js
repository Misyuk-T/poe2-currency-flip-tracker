import test from "node:test";
import assert from "node:assert/strict";
import { buildIdentityTaxonomy } from "../src/domain/identity-taxonomy.js";

const catalogItems = [
  { id: "known-lineage-a", name: "Known A", category: "Lineage Support Gems" },
  { id: "known-lineage-b", name: "Known B", category: "Lineage Support Gems" },
  { id: "ritual-a", name: "Idol A", category: "Ritual" },
  { id: "ritual-b", name: "Idol B", category: "Ritual" },
  { id: "expedition-a", name: "Expedition A", category: "Expedition" },
  { id: "expedition-b", name: "Expedition B", category: "Expedition" },
  { id: "duplicate-a", name: "Ambiguous", category: "Currency" },
  { id: "duplicate-b", name: "Ambiguous", category: "Fragments" },
];

const identities = {
  "Metadata/Items/Gems/KnownA": { name: "Known A", class: "Support Skill Gem", art: "2DItems/Gems/Lineage/A", shortId: "known-lineage-a" },
  "Metadata/Items/Gems/KnownB": { name: "Known B", class: "Support Skill Gem", art: "2DItems/Gems/Lineage/B", shortId: "known-lineage-b" },
  "Metadata/Items/Idols/KnownA": { name: "Idol A", class: "SoulCore", art: "2DItems/Currency/RitualIdols/A", shortId: "ritual-a" },
  "Metadata/Items/Idols/KnownB": { name: "Idol B", class: "SoulCore", art: "2DItems/Currency/RitualIdols/B", shortId: "ritual-b" },
  "Metadata/Items/Keys/ExpeditionA": { name: "Expedition A", class: "MapFragment", shortId: "expedition-a" },
  "Metadata/Items/Fragments/ExpeditionB": { name: "Expedition B", class: "MapFragment", shortId: "expedition-b" },
};
const observedIds = new Set(Object.keys(identities));

test("identity taxonomy prefers official ids and unique official names", () => {
  const resolve = buildIdentityTaxonomy({ catalogItems, identities, observedIds });
  assert.equal(resolve("Metadata/Whatever", { name: "Known A", shortId: "known-lineage-a" }).taxonomySource, "official-id");
  assert.deepEqual(resolve("Metadata/Whatever", { name: "Idol B" }), {
    category: "Ritual", taxonomySource: "official-name", taxonomyConfidence: 1,
  });
});

test("identity taxonomy learns only supported unambiguous path prefixes", () => {
  const resolve = buildIdentityTaxonomy({ catalogItems, identities, observedIds: new Set([...observedIds, "Metadata/Items/Gems/New", "Metadata/Items/Idols/New"]) });
  const lineage = resolve("Metadata/Items/Gems/New", { name: "New lineage", class: "Support Skill Gem", art: "2DItems/Gems/Lineage/New" });
  assert.equal(lineage.category, "Lineage Support Gems");
  assert.equal(lineage.taxonomySource, "learned-prefix");
  const ritual = resolve("Metadata/Items/Idols/New", { name: "New idol", class: "SoulCore", art: "2DItems/Currency/RitualIdols/New" });
  assert.equal(ritual.category, "Ritual");
});

test("ambiguous names do not become official matches or hardcoded guesses", () => {
  const resolve = buildIdentityTaxonomy({ catalogItems, identities, observedIds });
  assert.deepEqual(resolve("Metadata/Items/Elsewhere/Ambiguous", { name: "Ambiguous" }), {
    category: null, taxonomySource: "unresolved", taxonomyConfidence: 0,
  });
  assert.equal(resolve("Metadata/Items/Elsewhere/Thing", { name: "Thing", class: "StackableCurrency" }).taxonomySource, "repo-class");
});

test("identity taxonomy recognizes a deep Metadata segment that exactly names an official category", () => {
  const resolve = buildIdentityTaxonomy({ catalogItems, identities, observedIds });
  const inferred = resolve("Metadata/Items/Currency/Expedition/NewKey", { name: "New key", class: "MapFragment" });
  assert.equal(inferred.category, "Expedition");
  assert.equal(inferred.taxonomySource, "official-path-token");
  assert.equal(inferred.taxonomyEvidence, "Expedition");
});

test("prefix inference is disabled outside the observed CX universe", () => {
  const resolve = buildIdentityTaxonomy({ catalogItems, identities, observedIds });
  const unrelated = resolve("Metadata/Items/Gems/Future", { name: "Future", class: "Support Skill Gem", art: "2DItems/Gems/Lineage/Future" });
  assert.equal(unrelated.taxonomySource, "repo-class");
});
