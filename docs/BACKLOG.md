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
**2c compounds this:** the live path now loops N streams (PoE1 + PoE2) serially,
each up to `min(maxBackfillHours,12)` digests — ~24 fetches/txns per invocation,
and if stream 1 eats the budget or throws, stream 2 never runs. Live activation
needs a TOTAL invocation deadline/budget across streams (or per-stream scheduled
cron jobs), not just a per-stream cap.

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
