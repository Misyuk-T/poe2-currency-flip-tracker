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

## GGG OAuth features (leagues / ladder / characters) — task queue (2026-07-24)
Three feature ideas from a full pass over `developer.pathofexile.com`'s scope
list, analyzed before/after by a second model pass. All three share ONE hard
external dependency (T1) and rank below the ingest-canary/live-activation/
Phase 3 work above. See DECISIONS.md for the full before/after writeup if it
gets added; this is the task queue.

Shared gate: T1. T8/T9 additionally gated on `PROVIDER_MODE=live` + Phase 3
identity mapping — see [Inventory valuation](#inventory-valuation-оцінка-всього-інвентарю)
below.

- **T1 (S, external latency)** — Request `service:leagues` +
  `service:leagues:ladder` + `account:characters` scopes, plus a redirect URI
  (for T8, requested now to avoid a second GGG round-trip), on the existing
  "PoE2 Flip Helper" application. Reply on the same GGG OAuth Team email
  thread used for the cxapi CDN reply (2026-07-21) rather than filing a new
  application — GGG's dev docs currently say new applications aren't being
  processed, but this extends an already-approved app. HARD DEP for T2–T9.
- **T2 (S, dep T1)** — Token plumbing: `src/providers/ggg-oauth-client.js`,
  client-credentials fetch + in-memory expiry cache, env
  `GGG_OAUTH_CLIENT_ID`/`GGG_OAUTH_CLIENT_SECRET`, `.env.example`, mocked-fetch
  tests.
- **T3 (M, dep T2)** — League auto-sync: migration `league_meta` (game,
  league id/name, category, start_at, end_at, fetched_at); daily-guarded
  refresh inside the existing `/api/cron/radar`; `gameConfigs()`/`getConfig()`
  in `apps/web/lib/radar-backend.js` union DB leagues with the current env
  list (env stays fallback; the `hasPricedCandles` probe still gates which
  leagues get offered). **Verify first**: `service:leagues` league names must
  byte-match the league strings in CX digests, or leagues silently go empty.
  Fixes a real gap: `resolveLeague()` currently 400s any league outside the
  hardcoded `LEAGUE`/`LEAGUES` env vars in `src/server/config.js`, even though
  live ingest already stores new leagues — so a league launch (peak traffic +
  volatility) currently needs a manual env edit + redeploy to reach users.
- **T4 (S, dep T3)** — "League day N · ends in M d" chip in `MarketDashboard`
  from `/api/config`, labelled with source + fetched-at age. No forecast
  language.
- **T5 (M, dep T2)** — Ladder snapshot ingest only (no UI yet): migration
  `ladder_snapshots` (game, league, fetched_at, raw top-1000 jsonb +
  aggregates: median level, counts ≥ level thresholds, dead count), ~6h
  guarded fetch in the cron. Start early — value compounds with league-cycle
  history, near-zero on day one.
- **T6 (S-M, dep T5 + ≥2 wks of snapshots + live CX rows)** — Offline
  backtest (`scripts/`, `canary-live.mjs`-style): ladder aggregates vs
  ratio-dispersion/volume by league day. "No correlation found → descriptive
  panel only, no combined signal" is an accepted outcome — the ethos forbids
  shipping an unbacktested signal.
- **T7 (M, dep T6)** — "League Pulse" panel: descriptive metrics always ship
  ("day N, top-1000 median level, +Y levels/day, CX volume trend"); a combined
  early/mature verdict only if T6's backtest supports it, shown with its own
  numbers ("in X of Y past league-windows…"). Must label the top-1000 cap as
  an elite-progression proxy that saturates ~2 weeks in — early-league
  instrument only, not a whole-economy read.
- **T8 (M-L, dep T1 + live activation + Phase 3 mapping)** — GGG OAuth login
  (authorization-code + PKCE): `/api/auth/poe/login` + `/callback`, encrypted
  httpOnly cookie session. **Separate from the Supabase/Google auth track**
  (2026-06-27 decision, kept for the paper-trade journal) — record the
  dual-auth decision in DECISIONS.md before building, don't conflate them.
- **T9 (M, dep T8)** — "Currency in your pocket" valuator: `/api/me/inventory`
  reads the active character's `inventory` (backpack — `account:stashes` full
  tabs stay PoE1-only, see below), filters currency-frame items, maps names to
  catalog short ids (needs Phase 3), prices via the `rates`-map form of
  `workingPrice`/`convertMarketPrice` already generalized in
  `apps/web/lib/price-guidance.js`. **Hard-gate `PROVIDER_MODE=live`** — never
  price a real inventory against fixture ratios.

Order rationale: T1 costs nothing to send now and gates everything, so send it
immediately. T3/T4 are the best value-to-effort (closes a real live gap at
peak-traffic moments). T5 goes early because its value is time-compounding.
T6 must gate T7 (no unbacktested signal). T8/T9 are the largest build and
weakest standalone payoff (backpack-only — see Inventory valuation below) but
their scope rides free on T1, so request it now regardless of build order.

## Inventory valuation ("оцінка всього інвентарю")
Value a player's entire inventory/stash against current CX market data: paste or
import a set of items → total worth in exalted/divine, per-item breakdown,
liquidity/volume flags, and "what's actually sellable vs dead weight". Natural
extension once the identity/mapping layer (Metadata → name/icon/price) exists,
since valuation needs exactly that map plus current ratios.

**Checked against the official API docs (2026-07-24) — partially blocked for
PoE2:** `account:stashes` (full stash tabs) is explicitly **PoE1-only** in the
reference docs — PoE2 is not a listed realm, so a "log in and see your whole
stash" flow cannot ship today. But `account:characters` DOES support
`realm=poe2` and returns the active character's `inventory` (backpack) — a
real, narrower opening tracked as **T8/T9** above ("currency in your pocket").
Until GGG extends `account:stashes` to PoE2 (re-check the docs periodically —
T8/T9's OAuth plumbing serves full-stash valuation unchanged the day it
lands), options for whole-inventory valuation stay: (i) manual paste/entry
(works now, same friction as poe2scout-style tools), (ii) PoE1-only stash
import as a side feature since that scope already covers PoE1 (lower priority
— PoE2 is the product focus).
- Anchor: value in exalted + divine; show gold-cost-to-liquidate (ties into the
  existing gold wedge).

## API opportunities to explore
The public CDN gives more than hourly ratios — worth a dedicated exploration
session to find features the giants don't ship. Verified against the official
reference docs (2026-07-24):
- **No completed-sale / "most expensive item sold" data exists anywhere in
  GGG's API.** Currency Exchange gives ratios + volume, not transactions; GGG
  does not track or expose completed player-to-player trade prices at all —
  trades happen via whisper/instance, off-API. Nobody (not us, not poe.ninja)
  can show real "last sold price," only current asks/ratios.
- **No general item-trade search API.** The `pathofexile.com/trade` search
  players use isn't part of the public developer API surface — it's a separate
  internal system. Don't scrape it; out of scope/ToS risk.
- **Public Stash Tabs API (`service:psapi`)** — public, no per-player login,
  streams *every* public stash tab in the game (items + price `note` field +
  `accountName`) via a `next_change_id` cursor, ~5 min delay. This is the
  actual mechanism poe.ninja-style tools use to derive real market prices from
  players' own asking-price notes at scale. **PoE1-only today** (not listed
  for PoE2) — a real opportunity to prototype once GGG extends it, or as a
  PoE1 differentiator now.
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
