# Backlog

Ideas parked for later. Not committed work — candidates to pull into a phase.
Newest first.

## ⚠️ Ingest exceeds the 60s budget (found 2026-07-21, must fix before go-live)
Every hourly `radar-ingest-hourly` run times out at the 60s pg_net limit
(observed on requests 625–629; the Vercel function `maxDuration=60` too). In
FIXTURE mode it still limps because `ingestFixtures` re-seeds the whole 676k-row
catalog each run and idempotent backfill accumulates across runs — but the run
never cleanly finishes. Live mode (real ~2MB/hr digests × all public leagues × 2
games) will be far heavier and 60s will not be enough.
Fix directions: make ingest incremental/bounded per run (don't re-seed the full
fixture catalog hourly; cap digests + rows per invocation), stream/paginate the
write, or split ingest into a queue/multiple smaller invocations. Blocker for
Phase 5 (go-live activation).
**2c compounds this:** the live path loops N streams (PoE1 + PoE2) serially,
each up to `min(maxBackfillHours,12)` digests — ~24 fetches/txns per invocation.
**RESOLVED for LIVE (Phase 5a):** `ingestLiveStreams` now enforces a shared
wall-clock budget (`cxapiIngestBudgetMs`, default 45s) across all streams +
mid-stream, so a run always returns under 60s; cursors persist for catch-up.
**Still open — FIXTURE:** `ingestFixtures` re-seeds the whole 676k catalog every
run and still times out (harmless: idempotent accumulation, data stays fresh).
Low priority; bound it (synthesize only the newest hour after initial backfill)
when convenient. Not a go-live blocker (fixture is dev/demo only).

## Pre-activation checklist (before flipping PROVIDER_MODE=live)
The local live-data canary PASSED (`scripts/canary-live.mjs`): 28 real poe2 hours,
511 price-orientation checks independently verified vs raw ratios (121 inverse +
390 direct), volume-side provenance, cross-anchor reciprocal (divine@ex × ex@div =
1.00000, divine ≈ 407.5 ex), league isolation, identity, structural invariants.
Price-normalization correctness is activation-quality. Remaining MUSTs (codex):
1. **Terminal-hour poisoning fix.** `ingestLive` currently normalizes + records the
   terminal/in-progress digest (next_change_id <= digestId) then breaks. Today the
   terminal is empty (harmless), but a nonempty all-zero terminal would persist NULL
   candles for hour T; `ON CONFLICT DO NOTHING` then blocks the real T candles from
   replacing them. Fix: do NOT persist a terminal digest (break before recordCxDigest)
   — or make conflict handling let valid data replace a null-price candle. Ripples
   the ingest test mocks (they use next==id as a data-bearing "stop"); update them.
2. **Disposable/staging Postgres round-trip** through the REAL provider → ingestLive
   → recordCxDigest → readCandleWindow → buildRadarPayload, with all public leagues
   and an overlapping repeat ingest. Validates what the in-memory canary can't:
   serialization/hydration, PK conflict (null-then-valid), migration/index/plans,
   10s op limits, cursor transactionality, provider="live" read isolation. Use a
   throwaway DB/schema — NOT the prod `live` scope (cursor is keyed (game,realm,
   provider); a stray write could touch prod cursor state).
3. Flip `PROVIDER_MODE=live` + cron `:05`→`:10`, with monitoring: cursor age,
   latest-candle age, inserted-row counts, null-price rate, ingest errors.

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
