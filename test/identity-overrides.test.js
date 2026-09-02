import test from "node:test";
import assert from "node:assert/strict";

import { resolveCurrency, identityCategories, identityIcons, identityNames } from "../src/domain/cx-identity.js";
import {
  loadIdentityOverrides,
  readIdentityOverridesCached,
  resetIdentityOverridesCache,
} from "../apps/web/lib/identity-overrides.js";

const CONFIG = {
  poeGame: "poe2",
  poeRealm: "poe2",
  league: "Runes of Aldur",
  providerMode: "live",
  cxapiStreams: [{ game: "poe2", realm: "poe2" }],
};

const EXALTED = "Metadata/Items/Currency/CurrencyAddModToRare";
const TAIL = "Metadata/Items/Currency/CurrencyBrandNewThing";

const row = (extra = {}) => ({
  metadataId: TAIL,
  name: "Brand New Orb",
  icon: "https://example.test/new.png",
  category: "Currency",
  subcategory: "Core currency",
  shortId: "brand-new-orb",
  source: "repoe-catalog",
  resolvedAt: 1,
  updatedAt: 1,
  ...extra,
});

const repoWith = (rows, { onRead = () => {} } = {}) => () => ({
  readCxIdentity: async () => {
    onRead();
    return rows;
  },
});

test("a DB row wins per field, and a DB null never blanks the committed answer", () => {
  const overrides = new Map([
    [TAIL, { name: "Brand New Orb", icon: "https://example.test/new.png", category: "Currency", subcategory: "Core currency", shortId: null }],
    // A half-resolved row for an id the committed JSON fully answers.
    [EXALTED, { name: "Renamed Exalted Orb", icon: null, category: null, subcategory: null, shortId: null }],
  ]);

  const tail = resolveCurrency(TAIL, "poe2", { overrides });
  assert.deepEqual([tail.name, tail.icon, tail.category, tail.subcategory], [
    "Brand New Orb",
    "https://example.test/new.png",
    "Currency",
    "Core currency",
  ]);
  assert.equal(tail.taxonomySource, "cx-identity-db");

  const committed = resolveCurrency(EXALTED, "poe2");
  const merged = resolveCurrency(EXALTED, "poe2", { overrides });
  assert.equal(merged.name, "Renamed Exalted Orb", "DB name outranks the committed one");
  assert.equal(merged.icon, committed.icon, "a null DB icon leaves the committed icon standing");
  assert.equal(merged.shortId, committed.shortId, "a null DB short id leaves the committed bridge intact");
  assert.equal(merged.category, committed.category);
});

test("with no override at all an unmapped id still falls through to the humanized leaf", () => {
  const bare = resolveCurrency(TAIL, "poe2", { overrides: new Map() });
  assert.deepEqual([bare.name, bare.icon, bare.category], ["Currency Brand New Thing", null, null]);
});

test("the bulk identity maps take the same precedence, keyed by Metadata id and short id", () => {
  const overrides = new Map([[TAIL, { name: "Brand New Orb", icon: "https://example.test/new.png", category: "Currency", shortId: "brand-new-orb" }]]);
  assert.equal(identityNames("poe2", { overrides })[TAIL], "Brand New Orb");
  assert.equal(identityNames("poe2", { overrides })["brand-new-orb"], "Brand New Orb");
  assert.equal(identityIcons("poe2", { overrides })["brand-new-orb"], "https://example.test/new.png");
  assert.equal(identityCategories("poe2", { overrides })[TAIL], "Currency");
  // Untouched ids keep the committed answer.
  assert.equal(identityNames("poe2", { overrides })[EXALTED], "Exalted Orb");
});

test("a missing cx_identity table is traced once and degrades to an empty map", async () => {
  resetIdentityOverridesCache();
  const traced = [];
  const makeRepo = () => ({
    readCxIdentity: async () => {
      const error = new Error('relation "cx_identity" does not exist');
      error.code = "42P01";
      throw error;
    },
  });
  const overrides = await loadIdentityOverrides("poe2", {
    config: CONFIG,
    makeRepo,
    trace: (phase, details) => traced.push({ phase, ...details }),
  });
  assert.equal(overrides.size, 0);
  assert.deepEqual(traced.map((entry) => entry.phase), ["cx-identity.table-missing"]);
  // The committed JSON still answers everything it always did.
  assert.equal(resolveCurrency(EXALTED, "poe2", { overrides }).name, "Exalted Orb");
  resetIdentityOverridesCache();
});

test("a cold burst issues ONE read, and the result is cached for the whole TTL", async () => {
  resetIdentityOverridesCache();
  let reads = 0;
  const makeRepo = repoWith([row()], { onRead: () => (reads += 1) });
  const options = { config: CONFIG, makeRepo, trace: () => {}, now: 1_000 };

  const [a, b, c] = await Promise.all([
    loadIdentityOverrides("poe2", options),
    loadIdentityOverrides("poe2", options),
    loadIdentityOverrides("poe2", options),
  ]);
  assert.equal(reads, 1, "single-flight: the promise is cached before it is awaited");
  assert.equal(a, b);
  assert.equal(b, c);
  assert.equal(a.get(TAIL).name, "Brand New Orb");

  await loadIdentityOverrides("poe2", { ...options, now: 2_000 });
  assert.equal(reads, 1, "still inside the TTL");

  await loadIdentityOverrides("poe2", { ...options, now: 1_000 + 600_001 });
  assert.equal(reads, 2, "the TTL expired");
  resetIdentityOverridesCache();
});

test("the loader counts iconless rows so /api/status needs no second query", async () => {
  resetIdentityOverridesCache();
  const rows = [
    row(),
    row({ metadataId: `${TAIL}2`, icon: null, shortId: null, source: "repoe" }),
    // Nothing usable at all: counted as unresolved, kept out of the merge.
    { metadataId: `${TAIL}3`, name: null, icon: null, category: null, subcategory: null, shortId: null, updatedAt: 1 },
  ];
  const state = await readIdentityOverridesCached("poe2", {
    config: CONFIG,
    makeRepo: repoWith(rows),
    trace: () => {},
  });
  assert.equal(state.overrides.size, 2);
  assert.equal(state.unresolved, 2);
  resetIdentityOverridesCache();
});

test("no database at all is an empty map, not a throw", async () => {
  resetIdentityOverridesCache();
  const overrides = await loadIdentityOverrides("poe2", { config: CONFIG, makeRepo: () => null, trace: () => {} });
  assert.equal(overrides.size, 0);
  resetIdentityOverridesCache();
});
