/**
 * Live-data canary: validate the REAL go-live pipeline against REAL CDN data,
 * in-memory, WITHOUT touching the prod DB or the user-facing site.
 *
 * Runs the exact production code path (normalizeCxDigest + metadataToCanonicalId
 * -> memory repo -> buildRadarPayload) on ~28 recent poe2 hours for the exact
 * production league, and asserts the things a WRONG-but-plausible result would
 * violate (per codex "before" review): league isolation, an INDEPENDENT raw price
 * oracle, cross-anchor reciprocal, volume-side correctness, chronology, identity,
 * and structural payload invariants. Exits non-zero on any hard failure.
 *
 * Usage: node scripts/canary-live.mjs
 */

import { normalizeCxDigest } from "../src/domain/cx-market.js";
import { metadataToCanonicalId } from "../src/server/radar-ingest.js";
import { resolveCurrency, metadataForShortId, identityNames } from "../src/domain/cx-identity.js";
import { createMemoryRepository } from "../apps/web/lib/memory-repo.js";
import { buildRadarPayload, buildHistoryPayload } from "../src/server/radar-core.js";
import { loadCatalog, buildManifest, nameMapFromCatalog } from "../src/domain/catalog.js";
import { createGoldRegistry } from "../src/domain/gold-costs.js";
import { POE2_GOLD_COSTS } from "../src/data/gold-costs-poe2.js";

const REALM = "poe2";
const LEAGUE = "Runes of Aldur";
const HOURS = 28;
const UA = "poe2-currency-flip-tracker/0.1 (go-live canary; misyuktaras@gmail.com)";
const EXALTED = "Metadata/Items/Currency/CurrencyAddModToRare";
const DIVINE = "Metadata/Items/Currency/CurrencyModValues";
const CHAOS = "Metadata/Items/Currency/CurrencyRerollRare";

const problems = [];
const check = (cond, msg) => { if (!cond) problems.push(msg); return cond; };
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

async function fetchHour(id) {
  const res = await fetch(`https://web.poecdn.com/api/currency-exchange/${REALM}/${id}`, { headers: { Accept: "application/json", "User-Agent": UA } });
  if (!res.ok) throw new Error(`CDN ${res.status} for id=${id}`);
  return res.json();
}

async function main() {
  const nowHour = Math.floor(Date.now() / 3600_000) * 3600;
  let id = nowHour - (HOURS + 2) * 3600; // end ~2h before now to skip the in-progress hour
  const raws = [];
  const leaguesSeen = new Map();

  for (let i = 0; i < HOURS + 4; i++) {
    const payload = await fetchHour(id);
    const next = Number(payload.next_change_id);
    if (next === id) break; // terminal / in-progress hour: stop, do NOT ingest it
    // chronology: id must be hour-aligned and next = id + 3600
    check(id % 3600 === 0, `digest id ${id} not hour-aligned`);
    check(next === id + 3600, `next_change_id ${next} != id+3600 for id=${id}`);
    for (const m of payload.markets) leaguesSeen.set(m.league, (leaguesSeen.get(m.league) ?? 0) + 1);
    raws.push({ id, payload });
    id = next;
    if (raws.length >= HOURS) break;
  }
  check(raws.length >= 20, `fetched only ${raws.length} hours (< 20) — metrics may be thin`);

  // Ingest exactly ONE league (as Postgres would via scope.league), translated.
  const repo = createMemoryRepository({ game: "poe2", realm: REALM, league: LEAGUE, mode: "live" });
  let rejectedNullRatio = 0;
  let ingested = 0;
  const seenPairHour = new Set();
  for (const { id: digestId, payload } of raws) {
    const { candles } = normalizeCxDigest(payload, { digestId, league: LEAGUE, translate: metadataToCanonicalId });
    for (const c of candles) {
      check(c.league === LEAGUE, `candle league leak: ${c.league}`);
      check(!/\(PL\d+\)/.test(c.league), `private league leaked: ${c.league}`);
      const key = `${c.completedHour}|${c.pairId}`;
      check(!seenPairHour.has(key), `duplicate pair/hour after translation: ${key}`);
      seenPairHour.add(key);
      check(c.base !== c.quote, `collapsed pair ${c.pairId}`);
      if (c.low == null || c.high == null) rejectedNullRatio++;
      else check(c.low > 0 && c.high > 0 && c.low <= c.reference && c.reference <= c.high, `bad price band ${c.pairId}: ${c.low}/${c.reference}/${c.high}`);
      check(c.completedHour === digestId * 1000, `completedHour mismatch ${c.pairId}`);
    }
    await repo.recordCxDigest({ digestId, nextChangeId: Number(payload.next_change_id), candles });
    ingested += candles.length;
  }

  // === Independent raw price oracle (the key defense vs a reciprocal error) ===
  // Find, in the latest fully-populated hour, a market where the anchor is the
  // RAW LEFT side and one where it is the RAW RIGHT side, and verify the radar
  // reference matches quote/base (from the ORIGINAL ids), inverted as needed.
  const latest = raws[raws.length - 1].payload;
  const rowsExalted = (await buildPayload(repo, "exalted")).rows;
  const byTarget = new Map(rowsExalted.filter((r) => r.pairId).map((r) => [r.target, r]));

  let oracleLeft = 0, oracleRight = 0;
  for (const m of latest.markets) {
    if (m.league !== LEAGUE) continue;
    const [rawA, rawB] = m.market_pair;
    const isExA = rawA === EXALTED, isExB = rawB === EXALTED;
    if (!isExA && !isExB) continue;
    const lr = m.lowest_ratio, hr = m.highest_ratio;
    // Original orientation (market_id base|quote = rawA|rawB): price = quote per
    // base = ratio[rawB]/ratio[rawA]. Build the candle low/high/reference exactly
    // as normalizeCxDigest, then anchor exactly as candleForAnchor (INVERTING the
    // reference for the inverse orientation — 1/midpoint, NOT midpoint of inverses).
    const p = (r) => (r?.[rawA] > 0 && r?.[rawB] > 0 ? r[rawB] / r[rawA] : null);
    const pl = p(lr), ph = p(hr);
    if (pl == null || ph == null) continue;
    const candLow = Math.min(pl, ph), candHigh = Math.max(pl, ph), candRef = (candLow + candHigh) / 2;
    const target = isExA ? rawB : rawA;
    const short = resolveCurrency(target).shortId ?? target;
    const row = byTarget.get(short);
    if (!row) continue;
    // isExB: exalted=quote, target=base -> DIRECT (candle already = target-in-exalted).
    // isExA: exalted=base, target=quote -> INVERSE.
    const [expLow, expHigh, expRef] = isExB
      ? [candLow, candHigh, candRef]
      : [1 / candHigh, 1 / candLow, 1 / candRef];
    const ok = near(row.low, expLow, 1e-4) && near(row.high, expHigh, 1e-4) && near(row.reference, expRef, 1e-4);
    check(ok, `ORACLE mismatch ${short}: row ${row.low}/${row.reference}/${row.high} vs raw ${expLow}/${expRef}/${expHigh}`);
    if (isExA) oracleLeft++; else oracleRight++; // verify ALL — no early break
  }
  // Require BOTH orientations explicitly (was: >0 total, which 0 inverse could pass).
  check(oracleRight >= 10, `too few DIRECT-anchor markets verified: ${oracleRight}`);
  check(oracleLeft >= 1, `no INVERSE-anchor market verified: ${oracleLeft}`);

  // Inverse orientation is rare in the latest hour, so verify the inverse pair(s)
  // across MULTIPLE hours via the anchored history series vs the raw oracle.
  let inverseHours = 0;
  const rawById = new Map(raws.map((r) => [r.id, r.payload]));
  for (const m of latest.markets) {
    if (m.league !== LEAGUE || m.market_pair[0] !== EXALTED) continue; // exalted is base => inverse
    const target = resolveCurrency(m.market_pair[1]).shortId ?? m.market_pair[1];
    const pairId = [target, "exalted"].sort().join("|");
    const series = (await buildHistory(repo, pairId, "exalted")).series;
    for (const pt of series) {
      const raw = rawById.get(pt.completedHour / 1000);
      const rm = raw?.markets.find((x) => x.league === LEAGUE && x.market_id === m.market_id);
      if (!rm) continue;
      const p = (r) => (r?.[EXALTED] > 0 && r?.[m.market_pair[1]] > 0 ? r[m.market_pair[1]] / r[EXALTED] : null);
      const pl = p(rm.lowest_ratio), ph = p(rm.highest_ratio);
      if (pl == null || ph == null) continue;
      const cLow = Math.min(pl, ph), cHigh = Math.max(pl, ph);
      if (near(pt.low, 1 / cHigh, 1e-4) && near(pt.reference, 1 / ((cLow + cHigh) / 2), 1e-4)) inverseHours++;
      else check(false, `inverse history mismatch ${pairId}@${pt.completedHour}`);
    }
  }
  check(inverseHours >= 3, `too few inverse-orientation hour observations: ${inverseHours}`);

  // === Volume-side oracle: canonical keys map from the RAW sides, asymmetrically ===
  const asym = latest.markets.find((m) => {
    if (m.league !== LEAGUE) return false;
    const [a, b] = m.market_pair;
    const va = m.volume_traded?.[a] ?? 0, vb = m.volume_traded?.[b] ?? 0;
    return va > 0 && vb > 0 && Math.max(va, vb) >= 2 * Math.min(va, vb); // materially asymmetric
  });
  if (check(!!asym, "no asymmetric-volume market found to verify volume provenance")) {
    const [rawB0, rawQ0] = asym.market_pair;
    const single = normalizeCxDigest({ next_change_id: 1, markets: [asym] }, { digestId: raws[raws.length - 1].id, league: LEAGUE, translate: metadataToCanonicalId });
    const c = single.candles[0];
    const cb = metadataToCanonicalId(rawB0), cq = metadataToCanonicalId(rawQ0);
    check(c.volume[cb] === asym.volume_traded[rawB0], `volume base side wrong: ${c.volume[cb]} != ${asym.volume_traded[rawB0]}`);
    check(c.volume[cq] === asym.volume_traded[rawQ0], `volume quote side wrong: ${c.volume[cq]} != ${asym.volume_traded[rawQ0]}`);
    check(asym.volume_traded[rawB0] !== asym.volume_traded[rawQ0], "chose a symmetric market by mistake");
  }

  // === Cross-anchor reciprocal: divine@exalted * exalted@divine ~= 1 ===
  const payEx = await buildPayload(repo, "exalted");
  const payDiv = await buildPayload(repo, "divine");
  const divInEx = payEx.rows.find((r) => r.target === "divine" && r.pairId)?.reference;
  const exInDiv = payDiv.rows.find((r) => r.target === "exalted" && r.pairId)?.reference;
  if (check(divInEx > 0 && exInDiv > 0, `missing cross-anchor refs (divine@ex=${divInEx}, ex@div=${exInDiv})`)) {
    check(near(divInEx * exInDiv, 1, 5e-3), `reciprocal broken: divine@ex(${divInEx}) * ex@div(${exInDiv}) = ${divInEx * exInDiv}`);
    check(near(payEx.units.divineInExalted, divInEx, 1e-6), `units.divineInExalted ${payEx.units.divineInExalted} != ${divInEx}`);
  }

  // === Identity ===
  check(metadataForShortId("exalted") === EXALTED, "exalted reverse-bridge wrong");
  check(metadataForShortId("divine") === DIVINE, "divine reverse-bridge wrong");
  check(resolveCurrency(EXALTED).name === "Exalted Orb" && resolveCurrency(DIVINE).name === "Divine Orb", "anchor names wrong");
  let rawNamed = 0, coreIcons = 0, tradable = 0;
  for (const r of payEx.rows) {
    if (!r.pairId) continue;
    tradable++;
    if (/^Metadata\//.test(r.targetName)) rawNamed++; // a raw path leaked as a name
    if (r.gold?.status && r.target && !/^Metadata\//.test(r.target)) coreIcons++; // short-id (catalog) target
    // structural invariants
    check(r.target !== r.anchor, `target==anchor ${r.target}`);
    check(Number.isFinite(r.reference) && r.reference > 0, `bad reference ${r.target}`);
    check(Array.isArray(r.sparkline24h) && r.sparkline24h.every(Number.isFinite), `bad sparkline ${r.target}`);
  }
  check(rawNamed === 0, `${rawNamed} rows show a raw Metadata path as a name`);

  // ===== Report =====
  const known = payEx.rows.filter((r) => r.pairId && !/^Metadata\//.test(r.target)).length;
  const tail = payEx.rows.filter((r) => r.pairId && /^Metadata\//.test(r.target)).length;
  console.log("\n=== LIVE CANARY REPORT (poe2 / " + LEAGUE + ") ===");
  console.log(`hours fetched:        ${raws.length}`);
  console.log(`leagues in raw stream:`, [...leaguesSeen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([l, n]) => `${l}(${n})`).join(", "));
  console.log(`candles ingested:     ${ingested}  (null-price: ${rejectedNullRatio})`);
  console.log(`tradable rows (@ex):  ${tradable}  — core(short-id): ${known}, tail(Metadata): ${tail}`);
  console.log(`oracle verified:      left-anchor ${oracleLeft}, right-anchor ${oracleRight}`);
  console.log(`divine@exalted:       ${divInEx?.toFixed(4)}   exalted@divine: ${exInDiv?.toExponential?.(3)}   product: ${(divInEx * exInDiv).toFixed(5)}`);
  const top = payEx.rows.filter((r) => r.pairId && r.activityScore != null).sort((a, b) => b.activityScore - a.activityScore).slice(0, 8);
  console.log(`top movers (@exalted, by activity):`);
  for (const r of top) console.log(`  ${r.targetName.padEnd(34)} ${String(r.reference.toPrecision(5)).padStart(12)} ex   act=${r.activityScore}  vol=${r.volume ?? "-"}`);

  if (problems.length) {
    console.error(`\n❌ CANARY FAILED — ${problems.length} problem(s):`);
    for (const p of problems.slice(0, 40)) console.error("  - " + p);
    process.exit(1);
  }
  console.log("\n✅ CANARY PASSED — live pipeline produces correct output on real data.");
}

let sharedCtx;
async function buildPayload(repo, anchor) {
  if (!sharedCtx) {
    const catalog = await loadCatalog();
    const gold = createGoldRegistry(POE2_GOLD_COSTS, { game: "poe2" });
    const manifest = buildManifest(catalog, gold);
    sharedCtx = {
      catalogManifest: manifest,
      catalogById: new Map(manifest.map((i) => [i.id, i])),
      names: { ...identityNames(), ...nameMapFromCatalog(catalog) },
    };
  }
  return buildRadarPayload({
    repo, anchor, anchors: ["exalted", "divine"], shortlist: ["divine", "chaos", "vaal"],
    names: sharedCtx.names, catalogManifest: sharedCtx.catalogManifest, catalogById: sharedCtx.catalogById,
    source: { sourceMode: "official" }, now: Date.now(),
  });
}

async function buildHistory(repo, pair, anchor) {
  return buildHistoryPayload({ repo, pair, anchor });
}

main().catch((err) => { console.error(err); process.exit(1); });
