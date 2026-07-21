# Backlog

Ideas parked for later. Not committed work — candidates to pull into a phase.
Newest first.

## ⚠️ Ingest 60s timeout — code fix ready, runtime preview proof pending
Production evidence showed the problem predates live activation: Vercel reports
11 `/api/cron/radar` timeouts since July 6, and pg_net requests 632/634 (live)
and 635 (fixture after rollback) all died at exactly 60s. Fixture candles were
also stale since July 18, disproving the earlier claim that fixture cron worked
and the CDN was the likely blocker.

Branch `codex/ingest-diagnostics` addresses the shared path: structured phase
logs at every async boundary, error logging with a run id, poisoned postgres.js
client destruction on operation timeout, one live digest/run, PoE2-only default,
and fixture cron appending only the newest completed hour instead of rebuilding
168 x the full catalog. `INGEST_PROVIDER_MODE` is separate from `PROVIDER_MODE`,
so live rows can be preseeded while public reads remain fixture. Unit/build proof
is complete; one preview/runtime canary still must identify/confirm the exact DB
phase before any production read cutover.

## Pre-activation checklist (before flipping PROVIDER_MODE=live)
The local live-data canary PASSED (`scripts/canary-live.mjs`): 28 real poe2 hours,
511 price-orientation checks independently verified vs raw ratios (121 inverse +
390 direct), volume-side provenance, cross-anchor reciprocal (divine@ex × ex@div =
1.00000, divine ≈ 407.5 ex), league isolation, identity, structural invariants.
Price-normalization correctness is activation-quality. Status:
1. ✅ **Terminal-hour poisoning fix DONE** (db5f00a): `ingestLive` no longer persists
   a terminal/in-progress digest (breaks before recordCxDigest); cursor left at T so
   the next run re-fetches once complete. Regression test proves a nonempty zero-ratio
   terminal isn't persisted and the same hour lands once complete.
2. ✅ **Staging Postgres round-trip DONE** — disposable `canary_staging` schema
   (isolated from public/prod, dropped after). Validated the new-to-live persistence
   concerns: multi-league read isolation (HC didn't leak into a Runes read), tail
   Metadata `/` pair_id round-trip, jsonb/numeric/timestamptz serialization, and
   CONFIRMED the null-then-valid poisoning at the DB level (on-conflict-do-nothing
   keeps the null → validates fix #1). Prod untouched.
3. ⬜ Set **`INGEST_PROVIDER_MODE=live` while `PROVIDER_MODE=fixture`**, run one
   instrumented digest, and verify cursor/candles/timings. Flip the read mode only
   after recent live rows exist and `/api/status` succeeds. Never combine preseed
   and public read cutover in one deployment again.

## Phase 3 mapping — Metadata → {id, name, icon, category} data source (DECIDE)
Live CX candles are keyed by Metadata paths (`Metadata/Items/<Class>/<Leaf>`).
The radar needs a reliable map to real ids/names/icons. Findings (2026-07-21):
- The curated `catalog-poe2.json` (754 items) is keyed by trade short-ids and only
  covers currency-like categories — the CX universe also trades gems, runes,
  omens, soul cores, idols (627 distinct in ONE poe2 league-hour).
- RULED OUT — deriving Metadata ids from the catalog's image URL (`f` art path).
  It's the 2D ART asset, not the item id: it COLLIDES (e.g. `CurrencyAddModToRare`
  resolved to "Perfect Exalted Orb" while live data trades it as the base Exalted
  anchor) — only ~2% by count / 35% by volume, and WRONG for the anchor. Not usable.
Options: (i) find/scrape a real Metadata→name/icon source (poe2db, RePoE-style
data, or a GGG endpoint that exposes metadata ids) — needs permission + validation;
(ii) MVP: canonical id = the Metadata path, humanize the leaf for display, hand-map
only the anchors (exalted/divine/chaos) — honest but ugly names for the long tail;
(iii) hybrid: real map for the tradeable core, humanized fallback for the rest.
Also required in Phase 3 regardless: fix `candleForAnchor`/market-radar anchor
matching for the canonical namespace, and the history route rejecting `/` in pairs.

## Inventory valuation ("оцінка всього інвентарю")
Value a player's entire inventory/stash against current CX market data: paste or
import a set of items → total worth in exalted/divine, per-item breakdown,
liquidity/volume flags, and "what's actually sellable vs dead weight". Natural
extension once the identity/mapping layer (Metadata → name/icon/price) exists,
since valuation needs exactly that map plus current ratios. Open questions:
- Input source: manual entry, stash-tab import (needs OAuth/account scope — the
  CX CDN is account-agnostic), or a poe2scout-style paste?
- Anchor: value in exalted + divine; show gold-cost-to-liquidate (ties into the
  existing gold wedge).

## API opportunities to explore
The public CDN gives more than hourly ratios — worth a dedicated exploration
session to find features the giants don't ship:
- **volume_traded / lowest_stock / highest_stock** per pair per hour — depth,
  liquidity, and "is this flip actually fillable" signals (we store these already
  but barely surface them).
- **All leagues in one stream** — cross-league arbitrage / league-launch economy
  comparisons, HC vs SC premiums.
- **PoE1 + PoE2** from one client — cross-game currency-economy views.
- Long history back to Dec 2024 — seasonal/league-cycle trend analysis, "how this
  league's economy compares to prior leagues at the same day-N".
- Derived metrics: realized spread, volume-weighted price, stock-turnover, and
  detecting manipulation/thin markets.

TODO: schedule an exploration session to prototype 1-2 of these against real data.
