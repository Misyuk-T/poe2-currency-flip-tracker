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
