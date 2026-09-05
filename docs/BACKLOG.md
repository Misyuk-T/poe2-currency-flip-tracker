# Backlog

Ideas parked for later. Not committed work — candidates to pull into a phase.
Newest first.


## Follow-ups from the 2026-09-05 default-league threshold change

All three original entries are closed; see DECISIONS for each.

- ~~**(M) A dead league keeps the default forever.**~~ **Fixed 2026-09-05** —
  `refreshLeagueMeta` zeroes the depth of leagues absent from the window and
  `chooseDefaultLeague` only anchors on a default that still has pairs.
- ~~**(S) `movement(24)` can report a sub-day change as "24h".**~~ **Fixed
  2026-09-05** — `MIN_SPAN_RATIO` in `src/domain/market-radar.js`.
- ~~**(S) `--rl-text` is referenced but never defined.**~~ **Fixed 2026-09-05** —
  along with `--rl-accent`; `test/css-tokens.test.js` guards the next one.

Still open, from the same review round:

- **(S) Empty currency pages stay indexable during a league flip.** ~120 pages
  render "not traded in this league yet" for a few hours after the default moves.
  Measured and accepted (DECISIONS) because `noindex` is slower to undo than the
  empty state lasts. Worth revisiting only if a flip ever leaves a large share of
  pages empty for more than a day — the trigger to watch is the gap between a
  new league's market count and the outgoing league's.
- **(S) The in-memory repository's window is 30 days, the SQL one's is 7.**
  `apps/web/lib/memory-repo.js` claims to mirror the SQL semantics exactly and
  does not on `WINDOW_DAYS`. Test-only today, and the league-meta tests that care
  now pass `{ windowDays: 7 }` explicitly, but the next test to rely on the
  default will quietly exercise a window production does not have.


## Follow-ups from the 2026-09-03 db-layer hot-fix
- **Test gap:** `test/loader-connection-cascade.test.js` drives `tx(batch)`
  rather than `${sql(batch)}` through the `getSql()` handle, so a broken
  non-tagged proxy `apply` could still pass. Add a direct fragment assertion.
  (Codex review, low.)
- **Proxy → thunk cleanup:** the stable-handle Proxy in `apps/web/lib/db.js`
  could be replaced by having `createRadarRepository` take a `getSql` thunk and
  resolve per operation (~5 call sites, no metaprogramming). Deliberately not
  done on hot-fix day; both reviewers judged the Proxy correct against
  postgres.js 3.4.9.
- **Supavisor headroom:** the loader client doubles worst-case CLIENT sessions
  (instances × 2), not backend connections. Check the pooler's client-session
  cap before any big traffic event.

## Data freshness — what's automatic vs manual (2026-07-25)
Only the hourly price ratios are a live, always-on pipeline (Supabase
pg_cron -> pg_net -> `/api/cron/radar`, ingesting from the CX CDN). Item
metadata, icons, identity, gold costs, and the league list are NOT live —
they're git-committed snapshots, now closing the loop with a scheduled
review job instead of staying silently stale:

- **New items / names / categories** (`src/data/catalog-poe2.json`, 754
  items, GGG `trade2/data/static`) — `npm run catalog:build`.
- **Icons** — not a separate pipeline, but two different sources with very
  different reliability. Catalog items carry GGG's own hashed
  `pathofexile.com/gen/image/...` URL, which always resolves. Everything else
  (the CX long tail) only gets a URL *derived* from a RePoE art path, and GGG's
  CDN 404s a slice of those — the art path itself is wrong upstream, and no URL
  variant recovers it (`.png`/`.webp`, with/without `?scale`/`&realm`, even
  poe2db's CDN — all checked 2026-07-27). Handled at render time by a fallback
  chain built from live data (`apps/web/lib/icon-candidates.js`): the item's own
  icon, then a working sibling from its category, then an optional curated
  category glyph, then the neutral fallback. No per-item list to maintain, so
  new leagues and item classes are covered automatically.
- **Metadata id -> name/icon/category for the CX long tail** (gems, runes,
  omens, soul cores, idols) — `npm run identity:build`, sourced from RePoE;
  see the Phase 3 mapping entry below (done, not a gap).
- **Gold costs** (`src/data/gold-costs-poe2.js`, 651 items) —
  `npm run gold:build` (`scripts/build-gold-costs.mjs`, added 2026-07-25),
  scraped from poe2db.tw and matched against the catalog by name. Reproduced
  today's manual scrape byte-for-byte as a correctness check.
- **New leagues** — **automatic since c0d6c70 (2026-08-01), re-verified
  2026-09-02:** ingest takes every public league in the CX digest and
  `listPricedLeagues()` + `resolveLeagueAccess()` expose any league with
  priced candles without an env edit or redeploy. The *default* league (which
  scopes the SEO pages + sitemap) is **now data-driven too, shipped
  2026-09-02** (`6985783`): the hourly cron aggregates observed depth into
  `league_meta` and `chooseDefaultLeague` flips the default forward once a
  new league clears 8 completed hours and 200 priced pairs; `LEAGUE` env is
  now only an emergency pin — see `docs/LEAGUE-LAUNCH-RUNBOOK.md`. T3
  (`service:leagues`) now only adds official metadata (names before the
  first candle, start/end dates); blocked on T1.

**Shipped 2026-07-25:** `.github/workflows/data-refresh.yml` — a monthly
(+ manual `workflow_dispatch`) scheduled job running
`npm run data:refresh` (catalog metadata + identity + gold costs) and the
test suite, opening a PR only if something changed. **Deliberately does not
auto-merge or auto-deploy** — a human reviews the diff before any of this
reaches production, per the honesty rule (never silently change what's shown
to users). League auto-sync is intentionally NOT in this job — it needs the
GGG OAuth grant (T1), not a refresh script.

## ✅ Live activation + ingest timeout — DONE (verified 2026-07-27)
**Both of the entries that used to sit here are obsolete.** They described a
pre-activation world and, left stale, actively misled: they were read twice in
the 2026-07-27 session as evidence that production was still on fixture data
and that the cron was systematically failing. Neither is true.

Verified against production, not from memory:
- `/api/config` reports `providerMode: live` and the dashboard renders the
  **"Official GGG data"** badge. The `PROVIDER_MODE=fixture` cutover step is
  long done; local dev still shows "Sample fixture data" only because it has
  no `DATABASE_URL` and falls back to the in-memory fixture repo.
- The hourly cron is healthy. A representative run (18:05) completed in
  **28.9s** of its 300s budget, ingesting both games, 4 digests, ~9,000
  candles, `status:200`. Over 7 days Vercel recorded exactly **two** ingest
  failures — one transient `cxapi cdn returned 503` and one
  `recordCxDigest timed out after 10000ms` — not the "11 timeouts, every run"
  picture the old entry painted. The 10s guard behind that second failure was
  widened as part of the timeout-cascade fix below.

Kept as the standing lesson, since it still holds: never combine a preseed and
a public read cutover in one deployment.

## ✅ Phase 3 mapping — Metadata → {id, name, icon, category} data source — DONE
Live CX candles are keyed by Metadata paths (`Metadata/Items/<Class>/<Leaf>`).
Option (i) from the 2026-07-21 findings was built, not just decided:
`scripts/build-identity.mjs` / `build-identity-poe1.mjs` pull RePoE
(GGPK-derived, MIT) `base_items` data — 100% coverage of observed CX
currencies, validated (`CurrencyAddModToRare` -> "Exalted Orb", matching the
live anchor, not the earlier ruled-out art-path collision that misresolved
it to "Perfect Exalted Orb"). Output is committed as
`src/data/cx-identity-poe2.json` / `cx-identity-poe1.json`, icons re-joined
from `catalog-poe2.json` by exact name (not the collision-prone art path),
and consumed at read time via `src/domain/cx-identity.js` /
`resolveCurrency()`, wired into `getRadar`/`getConfig` in
apps/web/lib/radar-backend.js. The history-route `/` rejection is also
already fixed (the pair regex allows `/` in each id segment for Metadata-path
ids). **Corrected 2026-07-25** — this entry previously said "DECIDE"; it
was stale, the work had already shipped.

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
  **Closed 2026-09-02**: the "manual env edit + redeploy" gap this used to
  describe is fixed — `listPricedLeagues()`
  (`src/storage/radar-repository.js:222-240`) and `resolveLeagueAccess()`
  (`apps/web/lib/radar-backend.js:300-306, 363-366`) already discover and
  serve any public league with priced candles automatically, shipped in
  commit `c0d6c70` (2026-08-01). See `docs/LEAGUE-LAUNCH-RUNBOOK.md` for the
  verified automatic-vs-manual breakdown and the launch checklist. T3's
  remaining value is narrower: **official league metadata** (start/end dates,
  display name before the first candle exists) via GGG's `service:leagues`
  scope, still blocked on T1.
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

## trade2 API — how competitors price uniques (RESEARCH, do not start yet)
Answers a question the earlier "no item-search API exists" finding got wrong in
spirit: there IS no *documented* item-search API, but poe2scout.com prices
uniques and every item category through an **undocumented** endpoint, and their
source is public. Read from
`net/Poe2scout.UniquePriceLog.Worker/PoeTradeClient.cs` (2026-07-27):

- Base URL `https://www.pathofexile.com/api/trade2` — the same API behind the
  in-game trade site. `POST /search/poe2/{league}` to run a query, then
  `GET /fetch/{ids}?query=…&realm=poe2` for listing detail.
- **No authentication in that client at all** — no Bearer, no POESESSID, only
  `User-Agent: POE2SCOUT (contact: …)`. (`POEAPI_CLIENT_ID`/`SECRET` in their
  README belong to other workers, not this one.)
- Deliberately slow: **17s between POSTs**, 3s between GETs, 5 retries with a
  300s backoff on 403/503. Not aggressive scraping — a pace chosen to stay
  tolerated.

**Why this is parked, not queued.** It is a grey area: real and evidently
tolerated, but outside the documented API surface, with no guarantee. We are
mid-conversation with GGG asking for documented scopes — starting to poll an
undocumented endpoint in parallel is exactly the wrong signal at the wrong
time. Revisit only after the scope request is answered.

Also note the cost: at 17s per query, covering the unique universe is hours of
worker time per pass. That is an infrastructure project (queue, scheduling,
backoff, storage), not an evening's work.

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
