# Session log

Newest first. One block per working session: what changed + commit refs.

## 2026-07-26/27 — Compliance, real-data UX, icon fallbacks, cold-read 502s

**Two stale-doc corrections, both of which had already caused wrong advice.**
Production has been on live GGG data for some time (`providerMode: live`,
"Official GGG data" badge) — the BACKLOG's pre-activation checklist and
"ingest 60s timeout" entries described a world that no longer existed and were
read twice this session as evidence to the contrary. Also verified from Vercel
logs that the cron is healthy: a representative run finished in 28.9s of 300s,
and there were exactly two ingest failures in 7 days, not the "11 timeouts"
the old entry implied. Both entries replaced.

**GGG compliance (`643d742`)** — checked the app against the developer docs
before requesting more scopes and found two gaps the *previous* application
email had already claimed were in place: the required notice ("This product
isn't affiliated with or endorsed by Grinding Gear Games in any way.", exact
wording) was absent, and the User-Agent didn't follow the mandated
`OAuth {clientId}/{version} (contact: …)` shape. Both fixed; a scope-request
email for `service:leagues` + `service:leagues:ladder` drafted for the user to
send (deliberately *not* asking for `account:characters`, which needs a
different grant type than the app is registered for and would contradict the
earlier statement that users don't sign in).

**Real-data product work**
- `bb823a2` — "Best paid in" column (`lib/exit-currency.js`, unit-tested): the
  *worth* is identical whichever anchor you accept, but the **gold** is not
  (it scales with units received), and you can't receive a fraction of an orb.
  So the cheapest exit genuinely differs per item. The inventory demo now
  samples random **real** items off the live radar — only quantities invented —
  with stack sizes drawn log-uniformly so holdings land across the whole value
  range (previously every stack was large enough that divine always won).
- `bb823a2` — table defaults: category **Currency** (the market people come
  for, and ~35 rows instead of 200 on first paint) and a new default sort,
  "Item family" (`lib/item-family.js`, unit-tested) — name-sorting scattered
  tiers across the alphabet, price-sorting scattered them by value; family
  grouping keeps Regal → Greater Regal → Perfect Regal adjacent.
- `9b1d6e8` — brought back the green/red bars, but as the **real traded range**
  (body spans the observed low..high, no wick) rather than the old fabricated
  OHLC body. The wicks were always real; only open/close were invented.
- `242380b` — background scroll lock actually works now: it set `overflow:
  hidden` on `<body>` only, but the page scrolls on `<html>`, so the viewport
  kept scrolling behind every modal — including the pre-existing Trade view one.

**Icons (`efc1c04`, `59ef75c`, `e28368c`)** — traced to GGG's CDN 404ing a
slice of RePoE-derived art paths (no URL variant recovers them). Replaced the
hardcoded stopgap with fallback chains computed from live data; verified across
every game and league in production, where the only remaining fallback glyph is
the category literally named "Other".

**Cold-read 502s (`4f9d6cf`)** — see DECISIONS.md; timeouts were ordered
inwards so the database limit was unreachable.

**Tests:** 181 green.

**Open / user-owned:** send the GGG scope email; buy a domain (analysis in
ADVICE.md); then the Reddit post. Supabase MCP is unauthorized in-session, so
DB-side inspection needs the connector enabled.

## 2026-07-25 — Competitive BA pass, T1-T9 mocked demo, gold-cost table expansion

**BMAD competitive analysis** (poe.ninja, Exiled Tools, poe2fun.com checked
live): confirmed no automated/comprehensive gold-aware, backtested guidance
exists among competitors today — poe2fun.com is manual-entry only, Exiled
Tools currently shows no gold figure at all. The wedge concept is still
"contested not unique" (per the 2026-07-09 review) but nobody found executes
it as well. Biggest own gap identified: still on fixture/sample data in
prod — the ingest canary stays the top blocker for credibility.

**Shipped (`a8a46db`, pushed, preview deployed) — T1-T9 demo:** mocked
`service:leagues` / `service:leagues:ladder` / `account:characters` data
(`apps/web/lib/ggg-demo.js`) behind a visible purple DEMO badge, wired into
three new components (league day/countdown chip, descriptive-only League
Pulse ladder panel, "currency in your pocket" valuator that prices a mock
character's currency against REAL live radar rates). Browser-verified.
Nothing touches the real getConfig/getRadar paths.

**Shipped (`4b1eeaf`) — gold-cost coverage 9 -> 651 items (1.2% -> 86.3% of
the catalog):** confirmed no gold-cost formula exists anywhere (the official
CX CDN response has no gold/tax/fee field); scraped poe2db.tw's full
Currency Exchange table (664 items, every CX category) and matched 651 by
exact display name against `catalog-poe2.json`'s short ids with zero
collisions — the 9 prior hand-curated entries matched this scrape exactly
first, confirming it's an expansion of the same lineage, not a new source.
13 unmatched (rare idols/omens/uniques) omitted per the honesty rule rather
than guessed. See [DECISIONS.md](DECISIONS.md).

**Drafted, not sent:** the T1 email requesting `service:leagues` +
`service:leagues:ladder` + `account:characters` scopes on the existing GGG
OAuth application — user has the draft, needs to send it before T2+ can use
real (non-mocked) data.

**Tests:** 155 green.

## 2026-07-24 — Honest trend chart, session cache, GGG CDN confirmation, preview deploy

GGG's OAuth team email confirmed (again, in-chat) the Currency Exchange API is
public via CDN, no `service:cxapi` grant needed — matches the 2026-07-21
DECISIONS entry; added a superseded-by note on the old 2026-06-27 "stay on
sample data" entry so the doc doesn't read as still-blocked.

**Shipped (`adb6280`, pushed, preview deployed):**
- Dropped fabricated OHLC candlesticks — GGG only exposes an hourly low/high
  range, not real open/close. `SpotChart` now renders a median-bucketed line
  trend (`apps/web/lib/chart-series.js`, unit-tested).
- Session-scoped JSON cache (`fetchJsonCached`/`peekCachedJson` in
  `apps/web/lib/market.js`) that dedupes in-flight reads and prefetches the
  other game/league in the background, so market switching feels instant.
- `getConfig()` now probes `hasPricedCandles()` per league instead of assuming
  every configured league has data.
- `price-guidance.js` generalized to accept an arbitrary `rates` map (not just
  divine/chaos) — groundwork for the Phase 3 Metadata→id mapping.
- `/api/radar*` edge cache lengthened (source only advances hourly) + a slim
  top-of-panel progress indicator instead of a full loading wipe.

**BMAD pass on the open CDN** — reviewed `docs/BACKLOG.md`'s "API
opportunities" list; prioritized surfacing stored `volume_traded`/stock depth
as a liquidity signal (data already ingested, not yet on UI) as the cheapest
next win, then a cross-league comparison panel.

**Deploy:** pushed `codex/ingest-diagnostics` (2 commits) to origin — Vercel's
GitHub integration auto-built a **preview** deployment (not production; the
branch's runtime canary step in BACKLOG.md is still unverified, so no merge to
`main` yet).

## 2026-07-21 — Ingest timeout diagnosis and safe preseed path

Live evidence corrected the prior diagnosis: pg_net request 635 timed out in
fixture mode exactly like live requests 632/634, Vercel showed 11 historical
`/api/cron/radar` 60s timeouts, and fixture data was ~73h stale. Therefore CDN
blocking is not the supported explanation; the shared DB transaction path needs
phase-level runtime evidence.

Prepared `codex/ingest-diagnostics`: structured run-id/elapsed logs across route,
cursor, provider headers/body, normalization, transaction acquisition, timeout
setup, insert batches and cursor upsert; timeout destroys the cached postgres.js
client; duplicate live cursor read removed. `INGEST_PROVIDER_MODE` now decouples
preseed writes from `PROVIDER_MODE` reads. Live defaults to PoE2 and one digest
per run. Fixture cron writes only the latest completed hour instead of rebuilding
168 x the catalog, while local offline fallback retains full history. 126 tests
and the Next.js production build pass. Production behavior remains unchanged
until the branch is deployed and environment modes are deliberately configured.

## 2026-07-21 — CX go-live Phase 1: public CDN provider (behind a gate)

**Unblocked.** GGG replied — CX history is public via CDN, no OAuth needed
(see DECISIONS 2026-07-21). Probed the live endpoint to nail the real contract
before writing code: per-hour cursor, `digestId = requested id`, terminal
`next===id`, Metadata-path `market_id`, integer-pair ratios.

**Codex reviewed the plan first**, confirming the core blocker: ingested candles
store Metadata paths as base/quote while anchors are short ids (`exalted`), so
`candleForAnchor`/`market-radar` match nothing → an activated-but-unmapped radar
is silently empty. Also flagged the history route rejecting `/` in pair ids and a
`finiteNonNegative(null)→0` bug (deferred to Phase 2).

**Phase 1 shipped (not activated):**
- `src/providers/ggg-cdn-cxapi-provider.js` — public CDN provider, no auth,
  `digestId = requested id` (never `next-3600`), backward-cursor guard.
- `src/providers/create-cxapi-provider.js` — `cdn|oauth` selector.
- `src/server/config.js` — `CXAPI_SOURCE` (default `cdn`) + `CXAPI_CDN_BASE_URL`.
- `apps/web/lib/radar-backend.js` — uses the selector; CDN live defaults to a
  recent backfill window when no cursor/start id (no Dec-2024 no-id crawl).
- `.env.example` — documents the new vars.
- Tests: `cdn-cxapi-provider` (contract), `cdn-cx-normalize` (real captured
  payload + **documents the anchor-namespace bug**), `create-cxapi-provider`
  (selector), `cdn-ingest-loop` (real provider walked through `ingestLive` to the
  terminal), `test/fixtures/cdn-cx-sample.json` (2 real trimmed markets).

**Codex reviewed Phase 1**: cursor arithmetic/guard correct, terminal handled.
Fixed its P1 (CDN live activation/crawl safety) + P2s (env docs, selector +
ingest-loop tests). **Tests: 83 green.** PROVIDER_MODE stays `fixture` in prod.
Committed `feat(cxapi): public CDN provider ... (Phase 1)` (7552698).

**Course correction (user): PoE1 + PoE2 + ALL public leagues** (see DECISIONS
2026-07-21 correction). One CDN stream per game/realm already carries every
league per hour, so filtering to one league wasted the data. Decided to ingest
both games and all public leagues, excluding transient private `(PLxxxx)` ones.

**Phase 2a shipped (domain):** `normalizeCxDigest` now selects leagues (single /
allow-list / all-public default) and each candle carries its OWN league;
`isPublicLeague` drops private leagues. Legacy single-league callers unchanged.
Tests: `cx-multileague` (+4). **87 green.**

**Phase 2b shipped (storage rescope):** cursor is now per (game,realm,provider),
not per league — one CDN stream feeds every league. `recordCxDigest` writes
per-candle league (`c.league ?? scope.league`) in both Postgres + memory repos;
memory dedupe key now includes league. Migration `006_cxapi_state_per_stream_
cursor.sql` drops the league column + re-keys the PK. **Verified against the real
prod schema** (PK name `cxapi_state_pkey`, 1 fixture row, 676k candles untouched)
via read-only queries — DDL is safe. Codex-reviewed: fixed P1 (memory dedupe key)
+ P2s (migration tiebreaker, fake-tx contract test). **94 green.**

**DEPLOY ORDERING (important):** migration 006 is incompatible with the currently
deployed code (old cursor upsert targets `on conflict (game,realm,league,
provider)`). Apply to prod ONLY together with deploying this branch — sequence:
pause the ingest cron, apply 006, deploy, observe one fixture ingest. Reads
(candles table) stay compatible throughout; only the cursor write is affected,
and prod is fixture-only. Migration file is committed; **prod apply deferred to
the coordinated deploy window.**

**Phase 2b ROLLED OUT TO PROD (coordinated via Supabase + Vercel MCP):** paused
the `radar-ingest-hourly` pg_cron → applied migration 006 (verified new PK
`game,realm,provider`, league column dropped, 1 row preserved) → merged branch to
`main` + pushed → Vercel auto-deployed `dpl_HdFpQR…` (commit 93e5e5d, READY) →
verified end-to-end (a manual ingest trigger advanced `cxapi_state.updated_at`
under the NEW schema, which old code could not have done) → re-enabled the cron.
Prod healthy; reads never affected.

**Finding (pre-existing, not a regression):** every hourly ingest request times
out at the 60s pg_net/function limit (requests 625–629). Fixture ingest re-seeds
the full 676k catalog each run. Logged in docs/BACKLOG.md as a Phase-5 blocker —
live/multi-league/multi-game ingest needs to be incremental/bounded.

**Phase 2c shipped (multi-game/stream ingest):** live path loops one CDN stream
per (game,realm) — PoE1 + PoE2 — each all-public with its own cursor. Realm→CDN
segment map (poe1 = no segment). `cxapiStreams` config (deduped). Extracted
injectable `ingestLiveStreams`/`recentStartHour` (DB-free tested). Not activated
(prod fixture unchanged). Codex (gpt-5.6-sol): no P0/P1; fixed P2 dedup +
orchestration test. **100 green.** Committed 73d4137. BACKLOG: multi-stream
compounds the 60s ingest-timeout blocker.

**Phase 3a SHIPPED — identity layer (data-source problem SOLVED).** Found
RePoE-fork poe2 base_items (GGPK-derived, MIT): resolves 100% of observed live CX
currencies and the anchor CORRECTLY (`CurrencyAddModToRare` -> "Exalted Orb", where
the catalog art-bridge was WRONG). `scripts/build-identity.mjs` joins RePoE names
to catalog icons/short-ids BY NAME (art-path join collides — gave Greater/Perfect
Exalted the base "exalted"). `src/data/cx-identity-poe2.json` (4825 names, 773
icons) + `src/domain/cx-identity.js` (resolveCurrency / metadataForShortId /
humanize). next.config traces the JSON. Codex (gpt-5.6-sol): fixed P1 art-collision
(-> name join) + reverse-map order + P2 tracing/tests. 108 green. Committed 1e996ac.
Not wired into routes yet (prod unaffected).

**Phase 3b SHIPPED — canonicalize at ingest (the anchor unblock).** Chose to
translate live Metadata ids -> catalog SHORT ID at ingest (not carry Metadata
downstream): `normalizeCxDigest({translate})` reads ratio/volume/stock from the
ORIGINAL ids, stores base/quote/pairId + JSON keys as the canonical id.
`metadataToCanonicalId` + game-scoped `translatorForGame` (PoE2 only; PoE1 passes
through). So the short-id-keyed downstream (anchor, catalog/gold, history, SEO)
works UNCHANGED for the core, and fixture is a no-op. Also: names merge
`identityNames()` for tail targets; history route allows `/` in Metadata pairs.
PROVEN by test on the real captured CDN sample: short-id "exalted" now MATCHES
live candles (the documented blocker). Codex (gpt-5.6-sol): fixed P1 (PoE2
translator was applied to PoE1 -> game-scoped) + P2 tests. 113 green. Can't
live-verify until activation; unit-covered. NOT deployed (branch).

**MERGED 2c+3a+3b to `main` + deployed to prod (c63791b).** All behavior-preserving
for fixture (translator no-op, multi-stream is live-only, history regex is a
superset), NO schema change, so no cron/migration coordination needed — just merge
→ Vercel auto-deploy → verify fixture radar healthy. Prod still PROVIDER_MODE=fixture;
nothing activated. The whole go-live pipeline (provider → multi-league → multi-game
→ identity → anchor unblock) is now on prod, dormant behind the fixture flag.

**Phase 5a shipped (branch feat/cxapi-ingest-budget) — bounded live ingest.**
`ingestLiveStreams` enforces a shared wall-clock ceiling (`cxapiIngestBudgetMs`,
default 55s) minus a worst-case reserve (cursor read + fetch + tx ≈ 30s), so it
stops STARTING work at ~25s elapsed and the invocation always returns under the
60s function/pg_net limit; cursors persist for catch-up. `rotateStreams` rotates
the starting stream hourly so neither stream is starved. Codex (gpt-5.6-sol):
raised P1 (45s didn't guarantee <60s) — fixed with the reserve; confirmed P1+P2
clear. 117 green. FIXTURE ingest timeout left as-is (idempotent/harmless, backlog).

**Phase 5 pre-activation gates DONE (branch feat/cxapi-live-canary).**
- Live-data canary (scripts/canary-live.mjs, 2604d00): 28 real poe2 hours, 511
  price-orientation checks vs an INDEPENDENT raw oracle (121 inverse + 390 direct),
  cross-anchor reciprocal (divine@ex × ex@div = 1.00000, divine ≈ 407.5 ex),
  volume-side provenance, league isolation, identity, structural invariants. PASSED.
  Codex before (caught league:null mixing) + after (activation-quality).
- Terminal-hour poisoning fix (db5f00a): ingestLive won't persist the in-progress
  terminal digest; regression test + updated mocks. Codex: no blocking findings.
- Staging Postgres round-trip: disposable `canary_staging` schema — validated
  multi-league read isolation, tail Metadata `/` pair_id, jsonb/numeric/timestamptz
  serialization, and CONFIRMED null-then-valid poisoning at the DB level (validates
  the fix). Schema dropped; prod untouched. 118 green.

**Only Phase 5 step-3 remains: flip PROVIDER_MODE=live** (owner's explicit go —
real live data to users, reversible via the flag) + cron `:05`→`:10` + monitoring.
Then Phase 4 (frontend game/league selector) to surface PoE1/all-leagues.
Residual (backlog): finiteNonNegative(null)===0; duplicate cursor read (minor);
truly-unknown-to-RePoE ids render raw (rare).

--- superseded note (Phase 3 was blocked, now resolved in 3a) ---
Live candles store
Metadata paths (`Metadata/Items/<Class>/<Leaf>`); the radar needs a
Metadata→{id,name,icon,category} map to (a) fix anchor matching (`candleForAnchor`
compares short-id `exalted` vs stored Metadata path), (b) fix the history route
(rejects `/` in pair ids), (c) show names/icons. The curated 754-item catalog is
keyed by trade short-ids and only ~6% by count (~42% by volume) coincide — so
there is NO reliable public Metadata→name/icon source in-repo. Options to decide:
(i) derive/scrape a fuller map from a GGG static endpoint or community source
(poe2db/RePoE) — needs permission + validation; (ii) MVP: canonical id = Metadata
path, humanize the leaf for display, hand-verify only the anchors — honest but
ugly names for most; (iii) defer until a source is confirmed. Not started to
avoid fabricating a mapping or destabilizing the working fixture radar.

## 2026-07-10 — Trading-terminal dashboard: gold columns (the wedge, made visible)

**Backup first** — committed the pre-redesign state as restore point
`4f23f6f` + tag `backup-classic-dashboard` (user asked for a return point).

**Design review** — captured the live `/poe2` dashboard, found the #1 gap: the
gold wedge was invisible (no component referenced gold; columns were the same
BUY/SELL/SPREAD/TREND/LIQUIDITY as poe.ninja/poe2scout). Built two artifacts:
a written review, and 3 clickable full prototypes (Signal-first / Trading
terminal / Decision workbench). **User picked Trading terminal.**

**Implemented (real app)** — added two gold-aware columns to the radar table,
keeping all real GGG icons/logo/assets (`iconUrl`+fallback) untouched per the
user's ask:
- **Gold · 1-unit flip** — round-trip gold to flip one unit, via the domain
  `roundTripGold` (same model the paper-trade engine uses — nothing invented).
- **Profit / 100k** — quantity-independent gold-efficiency (anchor profit per
  100k gold); the metric free tools never show. Sortable + first sort option.
- Threaded `goldPerAnchor` through the radar payload (`radar-payload.js`) so the
  exit leg is priced correctly in placeholder AND real-gold modes.
- **Deliberately NOT added:** a "limiting resource" chip — no such logic exists
  in the current pipeline, so fabricating one would break the honesty rule.
- Default sort kept at `activity` (leads with recognisable liquid markets);
  profit/100k is a prominent column + top sort option.
Verified via Claude Preview: columns render, values real, gold-bright styling,
no page h-scroll (table scrolls in its own container), 68/68 domain tests green.

## 2026-07-09 — BMAD BA review, strategic pivot, gold-cost research (docs only)

**Product status reviewed** — Phases A/B/C1/C2a/C3a-b + D1–D4 shipped and live
(serverless Vercel + Supabase, fixture data); SEO P0–P2 + dark UI revamp done.
Blocked track is unchanged: everything live-data (C2b, C3c, SEO P3, D5) waits on
the un-applied-for GGG `service:cxapi` OAuth grant.

**BMAD business-analyst review** (persona "Mary") — verdict: A-grade portfolio
piece, C-grade business. **User agreed with all findings.** Recorded as two
DECISIONS entries: (1) strategic pivot — free tool, gold-wedge as hero, drop the
$5 sub, ship a labelled decision signal, resolve the two existential GGG risks
with one email; (2) gold-cost model is an honest approximation.

**Gold-cost research** — confirmed GGG publishes **no exact formula**; the
verified mechanic is per-order, per want-side item, scaling linearly with the
exchange ratio (rarity). Our `ceil(received_qty * goldPerUnit)` is a faithful
labelled approximation; only gap is static-table vs live-ratio scaling. Sources
in DECISIONS.md.

**Codex MCP note** — the codex (GPT-5.5) reviewer MCP is **not connected in this
session**; codex review must be run from an interactive `claude` where the server
is registered.

**Next (agreed sequencing):** polish dashboard + design into a beautiful demo →
*then* send the GGG cxapi application. Queue Search Console + analytics.

## 2026-06-29 — Remove legacy backend, dashboard-at-root (uncommitted working tree)

**Fixed `web:dev` error loop** — `lightweight-charts` (imported by
`SpotChart.jsx`) was unresolved; `npm install` + cleared `apps/web/.next/dev`.
`/`, `/poe2`, `/guides` → 200, no module errors (verified via Claude Preview).

**Removed the legacy standalone Node backend** (24 src files + `src/public/` +
26 tests + `dev`/`start` scripts). Traced Next→`src/` imports to prove the app
reuses only the radar pipeline subset; everything else was dead. Kept 17 tests
(66 checks) — all green. Catalog icons retargeted `src/public/icons` →
`apps/web/public/icons` (script + `.gitignore` + comments).

**Dashboard at root** — `app/page.jsx` 307-redirects to `/poe2`; landing moved
to `app/landing/page.jsx` (`/landing`, `noindex`); sitemap drops the redirecting
root, `/poe2` → priority 1. For GGG API-developer outreach (open straight to the
product).

**Codex (GPT-5.5) review** — no FAIL; independently ran `npm test` (66) +
`next build` (green). WARNs (sitemap root, README/catalog stale refs) all
addressed. See [DECISIONS.md](DECISIONS.md) (three 2026-06-29 entries).

**Docs:** README quickstart/architecture/live-mode/icon paths rewritten to the
serverless single-app reality; DECISIONS + this log updated.

## 2026-06-27 — SEO P1+P2, C3 paper-trade, BMAD docs

**SEO P0** — verified `NEXT_PUBLIC_SITE_URL` is already set in prod (sitemap /
robots emit the real origin); corrected the stale "emits localhost" note.

**SEO P1 (shipped, live, codex-reviewed ×2):**
- Data-backed `/poe2/currencies` index (ISR) — `2a49b68`
- Sitemap completeness + per-currency lastmod — `0eef290`
- Per-currency copy + FAQ + Breadcrumb/FAQPage JSON-LD — `3d9600a`
- Homepage mini-radar widget — `481d478`
- Codex fixes (honesty/lastmod/stale) + copy hedge — `7106f4c`, `69b5a48`

**C3 paper-trade (shipped, live, codex-reviewed ×2):**
- C3a engine `src/domain/paper-trade.js` — `8e5cec9`
- C3b simulated backtest on currency pages — `d7f65c6`
- Codex fixes: coverage-based resolution, tpHitRate vs profitableRate,
  same-candle exclusion, pending surfaced — `3b30aaa`
- Docs — `28ac1f9`
- Live check: divine backtest shows TP-hit 5.26%, avg −2%/trade (honestly
  unprofitable naive strategy — the point of C3).

**SEO P2 (shipped, live):**
- Related-currency internal links + CDN cache headers — `ad4558f`
- Don't cache degraded no-database status — `f605fde`
- Trim `/api/radar` ~575 KB → tradable rows — `570f13e`
- Fix edge caching via `Vercel-CDN-Cache-Control` (verified MISS→HIT) — `2461c43`

**Docs:** P0/P1/P2 marked in SEO_PLAN; C3 in NEXT_STAGE_PLAN; this BMAD `docs/`
set created.

**Tests:** 175 → 202, all green.

**Decided this session** (see DECISIONS.md): stay on sample data; auth =
Google via Supabase; buy a custom domain.

### Continuation (same day) — UI polish, docs, guides

- **BMAD living docs** created (this `docs/` set) + a memory that every session
  updates them.
- **Custom domain advice** — live availability checked (Vercel): `poe2flip.app`
  ($9.99) and `poe2flips.com` ($11.25) recommended; user buys it. See ADVICE.md.
- **Critical UI/responsive polish** (browser-verified + codex-reviewed) — `77c7094`:
  uniform full-width section cards (prose was narrower → ragged edge); icon
  cards now stack name/summary (ran inline before); `.currency-grid` auto-fit
  with `:where(:has(.with-icon))` so icon grids read a calm 3-up and still
  collapse to 1col on mobile. Dashboard verified unaffected.
- **Keyword guide pages** — `964aaee`: `/guides` hub + "Divine to Exalted ratio"
  + "PoE2 currency exchange", breadcrumb/FAQ JSON-LD, internal links, sitemap +
  nav wired. Codex-reviewed (honesty/links).

- **Homepage redesign to the approved reference** (`e57d86d`, `4a8f8de`,
  `4209717`) — two-column hero (left-aligned "Use the radar. / Not vibes." with a
  gold accent + gold CTA; right = a cohesive MARKET RADAR panel: movers rail with
  real per-currency sparklines, gold range chart, CURRENT/CONSERVATIVE PLAN row).
  Co-reviewed with codex (caught the chart-grid styles still scoped to the
  removed `.home-product-card`). Browser-verified live against the reference.
- **Answered:** Supabase Google auth needs a self-created Google OAuth client
  (unlike Firebase); exact steps + the `exalted-flip` callback URL are in
  ADVICE.md.

- **UI revamp — dark premium theme site-wide** (`40f49bb`, steps 1–3 of
  docs/UI-REVAMP-PLAN.md). codex-authored CSS + codex-reviewed (fixed a
  metric-value selector over-reach, kept --profit/--loss conventional so the
  dashboard chart stays consistent, AA-contrast CTA). `:root` dark tokens,
  global dark body, premium header, dark panels/cards/buttons/prose/breadcrumb/
  faq. Home + dashboard shell untouched. **Verified visually** across home /
  currency / index / guide / dashboard via the **Claude Preview** tool
  (`preview_start` from `.claude/launch.json` → `preview_screenshot`/`_eval`) —
  this is the reliable way to see the rendered UI when the Chrome MCP /
  computer-use screenshot tools are down. Looks premium and on-reference.

- **UI revamp steps 4–10** (`18d9278` + the foundation): dashboard header band
  (4) and currency-detail hero (6) came free with the shared-component
  conversion; index dark tiles (5), metric tiles (7) and home lower sections
  (10) too. Guide article + sticky sidebar (9) shipped + Preview-verified.
  **Step 8 (currency-detail editorial side-rail) intentionally skipped** — that
  page is already content-rich (hero, snapshot, backtest, about, FAQ, related),
  so a side-rail would duplicate the existing "Related" + "Open in radar".
  Revamp matches the reference across home / currency / index / guide /
  dashboard, verified via Claude Preview.

- **Dynamic OpenGraph images** (`59a446b`) — branded dark+gold `next/og` cards
  (shared `lib/og.jsx` helper): a site-default `app/opengraph-image` + a
  per-currency override (name; popular ids prebuilt). Branding/title only, no
  fabricated numbers. Verified by rendering the 1200×630 PNGs.

**Tests:** 202 green. **Still queued (non-blocked):** "how to flip X" guide;
**C3c Google-auth foundation prep** (migration + Supabase Auth + per-user RLS,
pending the user's Google OAuth app + secrets). **User action:** buy the domain;
set up Google OAuth in Supabase; Google Search Console.

## 2026-08-23 — GSC analysis, impressions-cliff diagnosis, SEO recovery plan

- **Analyzed 3-month Search Console data** (exileradar.com): 41 clicks /
  3.3K impressions / avg pos 29.3. Clicks are long-tail `<item> price`
  queries; head terms sit page 3+ with 0 clicks; "poe2 radar" brand query
  exists. **Impressions cliffed** ~130/day → <10/day around Aug 16–17.
- **League research:** Runes of Aldur (0.5.0, May 29) still running; 0.5.5
  ~mid-Sept (reveal likely Gamescom Aug 26–30); ExileCon Nov 7–8; 1.0
  predicted ~Dec 11. The cliff is NOT "season ended".
- **Live prod findings (curl):** pages fresh + canonical correct, BUT
  (a) old `poe2-currency-flip-tracker.vercel.app` still serves 200 duplicate
  content — no 301, canonical-only migration on a weeks-old domain;
  (b) `/` is a 307 temporary redirect to `/poe2`;
  (c) all 639 sitemap `lastmod` frozen at the Aug 8 build — app-router
  `sitemap.js` metadata routes ignore `revalidate` in several Next versions.
- **Top cliff hypotheses (ranked):** 1) domain-migration re-evaluation
  (~3 weeks after late-July switch), 2) thin-programmatic quality
  reassessment / Google update, 3) late-league demand decay (contributing).
- **Wrote [SEO-RECOVERY-PLAN-2026-08.md](SEO-RECOVERY-PLAN-2026-08.md)** —
  phases: 0 diagnostics (GSC per-query checks — needs the user), 1 migration
  hardening (301 vercel.app, fix root redirect, sitemap route handler) +
  price-pattern titles, 2 distribution round 1 (forum thread, directories) +
  content (evergreen-slug league-start guide, trends page), 3 Reddit on 0.5.5
  launch day (no Google Ads), 4 1.0 readiness.
- **Review:** Codex MCP hit its usage limit (resets Aug 27); ran an
  independent subagent review instead — 12 findings (domain migration missed,
  survivor-biased position metric, no live numbers in meta descriptions,
  distribution moved up, evergreen slug, FAQ rich results restricted) all
  incorporated into plan v2.

**User action:** GSC Phase-0 checks; decide when to start Phase 1.

## 2026-08-23 (пізніше) — GSC-діагностика напряму в Chrome: вердикт по обвалу

- **Перевірив GSC сам через Chrome MCP** (порівняння 17–23.08 vs 09–15.08):
  кліки 11→0, покази 916→34 (−96%), позиція 37,2→69,5. **Усі** запити впали
  до нуля показів після 16.08 — включно з брендом "poe2 radar" (був на 8,3)
  і топ-10 лонгтейлом ("olroth saga poe2 price", 8,5).
- **Санкцій немає** (Manual actions чисто, Security чисто). **Індексація
  стабільна**: 336 в індексі, без провалу на графіку. 280 сторінок
  "Discovered – not indexed" — Google не бере половину лонгтейлу.
- **Зовнішніх посилань: 0** (звіт Links: нуль сайтів, нуль анкорів).
- Google Search Status: **August 2026 spam update, 18–21.08** — міг підсилити,
  але обвал почався 16–17.08.
- **Вердикт:** закінчився "медовий місяць" нового домену (~4 тижні) без
  жодного беклінка — site-wide алгоритмічна демоція, знімати нічого,
  відновлення = посилання + on-page + гігієна міграції. План оновлено
  (Phase 0 закрита фактами).
- **Antigravity CLI знайдено** (`agy`, ~/.local/bin) — піде на ревю замість
  Codex (ліміт до 27.08).
- **Заспаунено 2 Opus-агенти** (worktree, паралельно): Phase 1
  (`seo/phase1-migration-onpage`: 301 з vercel.app, корінь, sitemap route
  handler, price-титули, чистка "sample data") і Phase 2
  (`seo/phase2-league-start-guide`: вічний slug /guides/league-start-currency).
  Далі: agy-ревю обох гілок.

## 2026-08-23 (вечір) — Фази 1–2 реалізовано агентами, agy-ревю CLEAN

- **Phase 1** (`seo/phase1-migration-onpage`, Opus-агент, 6 комітів,
  302/302 тестів): host-based 301 vercel.app→exileradar.com **з виключенням
  `/api/*`** — агент упіймав, що pg_cron/pg_net постить інжест на старий хост
  і не ходить за редіректами (сліпий 301 тихо вбив би щогодинну інжестію);
  міграція 008 перенацілює крон на exileradar.com (НЕ застосована — після
  деплою). Корінь: 307→308 (permanentRedirect), лендінг на `/` не монтували —
  задокументоване продуктове рішення "одразу в дашборд". Sitemap: metadata
  route → `app/sitemap.xml/route.js` + `lib/sitemap-xml.js`, revalidate 3600
  реально працює (перевірено білдом). Титули: `${name} Price — PoE2 Hourly
  Market Data`, опис без живих цифр, H1 з "price", WebPage JSON-LD
  синхронізовано. Чистка "sample data" у прод-видимих текстах.
- **Phase 2** (`seo/phase2-league-start-guide`, Opus-агент, 2 коміти,
  299/299): гайд `/guides/league-start-currency` (вічний slug), структура
  як у наявних гайдів, лігові факти в одному `currentLeague` const, нуль
  вигаданих цін/прогнозів, зареєстровано в hub/registry/sitemap.
- **Ревю: Antigravity CLI (`agy -p`, дифи інлайном у промпті — з тулзами
  таймаутиться).** Обидва CLEAN; єдина змістовна нотатка (raw `<a>` замість
  next/Link) виявилась конвенцією наявних гайдів — не дефект.
- **Не зроблено свідомо:** merge/push/deploy (чекає рішення користувача),
  migration 008 (після деплою).

**Далі:** merge обох гілок → деплой → застосувати 008 → перевірити
301/308/sitemap lastmod кроками з плану → форумний тред + каталоги (потрібен
Taras) → Reddit у день старту 0.5.5.

## 2026-08-23 (ніч) — MERGED + DEPLOYED

- **Змержено в main і задеплоєно** (2a87470): Phase 1 (fast-forward) +
  Phase 2 (merge) + доки. 302/302 тестів на змерженому main. Vercel build
  READY за ~20с.
- **Прод верифіковано curl-ом:** старий хост → 308 на exileradar.com;
  `/api/cron/radar` на старому хості НЕ редіректиться (401 без токена —
  живий); корінь → 308; титул "Divine Orb Price — PoE2 Hourly Market Data"
  live; гайд `/guides/league-start-currency` 200; **sitemap lastmod =
  поточна година (18:00Z) — розморозився**. 638 URL.
- Побічно підтвердився "деплой 8 серпня": останній прод-деплой до сьогодні
  був a6243d5 ("Point live link at exileradar.com") від 08.08.
- **Міграція 008 НЕ застосована:** Supabase MCP і CLI залоговані в інші
  акаунти (bim-dashboard / design-studio), дашборд у Chrome викинув на
  sign-in — вводити пароль/OAuth Claude не може. Інжест НЕ під загрозою:
  `/api/*` виключений з редіректу саме на цей випадок. Потрібно: Taras
  логіниться в supabase.com/dashboard, далі застосувати 008 і перевірити
  `cron.job`. Кандидати на проєкт: qbivdphhwfprbfbktskm (exalted-flip,
  з ADVICE.md) або hncvnczlhlonsxkwqkmf (supabase/.temp/project-ref).

## 2026-08-23 (пізня ніч) — міграція 008 застосована, повний цикл закритий

- Supabase CLI перелогінено у правильний акаунт (exalted-flip-v2 /
  hncvnczlhlonsxkwqkmf, LINKED). `supabase migration list`: віддалена історія
  чиста (002–007 + 2 timestamped), у черзі був тільки 008.
- **`supabase db push --include-all --yes` — 008 застосовано успішно**,
  Local 008 | Remote 008 підтверджено. (Браузерний шлях через SQL Editor
  заблокував авто-класифікатор — навіть read-only re-run; CLI-шлях чистіший.)
- До міграції останній інжест: `generatedAt 19:05Z` через старий хост
  (виключення `/api/*` відпрацювало). Фонова перевірка стоїть на ~20:08Z —
  очікуємо `generatedAt 20:05Z` вже через exileradar.com.
- Примітка: у робочій копії (codex/ingest-diagnostics) лежить untracked копія
  008 — ідентична main, зникне при мержі.
- **ФІНАЛ: перший крон-запуск через новий хост підтверджено** —
  `generatedAt 2026-08-23T20:05:01Z`, trackedCount 629 (без втрат).
  Міграційний ланцюг закритий повністю: 301/308 → sitemap live → титули →
  гайд → cron на exileradar.com. Легасі-хост більше ніде не використовується;
  виключення `/api/*` з редіректу можна прибрати в наступній ітерації.

## 2026-09-02 — статус-чек: GSC без відновлення, sitemap знову завмер, синк репо

- **Chrome MCP: два браузери.** Browser 1 (deviceId 57e77e22…) — персональний
  (misyuktaras@gmail.com), має доступ до GSC; Browser 2 (d3726ca2…) — робочий
  (anyforsoft), доступу немає. Записано в глобальний ~/.claude/CLAUDE.md і в
  пам'ять проєкту. Коннектора Search Console у реєстрі MCP немає; довгий
  варіант — Search Console API через service account + `scripts/gsc-report.mjs`.
- **GSC (Browser 1), факти:** 28 днів (04–31.08): 18 кліків / 1,65K показів /
  CTR 1,1% / позиція 31,8. **Останні 7 днів (25–31.08): 0 кліків / 5 показів /
  позиція 64,6** — відновлення після Phase 1–2 (деплой 23.08) ще нема, графік
  плоский на нулі з 16.08. Топ-запити за 28 днів: "poe2 currency" 14 imp,
  "poe 2 currency" 13, "olroth saga poe2 price" 11, "poe2 radar" 6 (0 кліків).
  **Індексація:** 325 в індексі (було 336), не в індексі 314: 280 "Discovered –
  not indexed", 30 "Crawled – not indexed" (було 19), 4 redirect.
  **Sitemap у GSC: подано 28.07, востаннє прочитано 31.07, 635 сторінок** —
  Google не перечитував sitemap місяць.
- **Прод здоровий:** інжест 14:05Z, 625 маркетів, снапшоти Runes of Aldur свіжі
  (exalted 625 рядків, max hour 13:00Z); за 7 днів 2 помилки крону (rate-limit
  CDN 27.08, network 31.08). 308 зі старого хоста і кореня стоять, гайд 200.
- **Баг: sitemap lastmod завмер на 2026-08-29T19:00Z** при свіжій БД і свіжій
  `/poe2/currencies` (той самий `getCurrencyIndex`, "as of 02.09 13:00").
  Vercel runtime logs: за годину запитів **нуль викликів функції
  `/sitemap.xml`**, відповіді `x-vercel-cache: HIT`; деплой 30.08 кеш не
  скинув (ISR-кеш Vercel живе між деплоями). Висновок: ISR `revalidate` на
  route handler на Vercel не спрацьовує. Фікс: `force-dynamic` + CDN-кеш через
  `Vercel-CDN-Cache-Control s-maxage=3600` — делеговано Opus-агенту
  (гілка `fix/sitemap-freshness`).
- **Vercel MCP працює** (prj_qrG7AIzXtpDNgQwPRUuuH8pzmAlD /
  team_hLfvNbFpgEDX98THDt3sE0V5): `get_runtime_errors` надійний, runtime logs
  лише 1h retention (Hobby), **Web Analytics не ввімкнена** (404).
  `supabase db query --linked` працює для read-only перевірок БД.
- **Репо:** origin/main мав 2 коміти Тараса (28–29.08, Currency Exchange
  layout refresh), робоча копія стояла на codex/ingest-diagnostics (−15).
  Перейшов на main, ff до 3ae26ac; два записи журналу за 23.08 (ніч), що жили
  лише в робочій копії, перенесено сюди.
- **Оркестрація (рішення Тараса):** голова — Fable, правки руками Opus 5 і
  слабших моделей. Запущено: Opus — фікс sitemap; Sonnet — перевірка анонсу
  0.5.5 після Gamescom.

**Дії Тараса:** увімкнути Vercel Web Analytics; форумний тред pathofexile.com +
каталоги (беклінків усе ще 0); після деплою фіксу — повторно подати sitemap у
GSC (востаннє прочитаний 31.07).

- **0.5.5 = "Forbidden Rites", старт 4 вересня 2026, 13:00 PDT** (Sonnet-ресерч,
  офіційний тред pathofexile.com/forum/view-thread/3999858; Runes of Aldur
  продовжується паралельно). 1.0 — 11 грудня 2026 (за пресою з трейлера
  Gamescom 25.08), ExileCon 7–8 листопада (підтверджено GGG). Це вікно Phase 3
  плану — за два дні. Запущено: Opus — оновлення `currentLeague` у гайді
  (гілка `content/forbidden-rites-league`); Sonnet — ранбук запуску ліги
  (env `LEAGUES`/`LEAGUE`, крон, перевірки).
- **Фікс sitemap готовий (Opus-агент):** гілка `fix/sitemap-freshness`,
  коміт f889992. `revalidate=3600` → `dynamic="force-dynamic"`, кеш на CDN
  через наявний `cacheHeader()` з `apps/web/lib/http.js` (здоровий шлях
  `s-maxage=3600, swr=86400`; деградований — DB-помилка АБО `index===null` —
  `s-maxage=300, swr=900`). Нові тести `test/sitemap-route.test.js` +
  заголовки в `test/sitemap-xml.test.js`; 315/315; `npm run web:build` показує
  `ƒ /sitemap.xml`. Відправлено на незалежне Opus-ревю (свіжий контекст).
- **Гайд оновлено під Forbidden Rites (Opus-агент):** гілка
  `content/forbidden-rites-league`, коміт a5fa0ba, лише
  `guides/league-start-currency/page.jsx` (`currentLeague`, інтро, FAQ +
  JSON-LD, абзац про механіки з двома офіційними лінками). 311/311, білд
  рендерить нову копію. **Агент виправив ресерч за первинними джерелами:**
  механіки (Ritual у кампанії, Viridian Wildwood, Trial of Chaos) — з
  прес-релізу view-thread/3999865, не з анонсу; "Runes of Aldur триває
  паралельно" — з FAQ view-thread/4000430; **FAQ каже, що Forbidden Rites іде
  до релізу 1.0 і закінчується разом з Runes of Aldur** (ресерч казав "без
  дати"); "без балансних змін" — нічим не підтверджено, викинуто; 1.0 11 грудня
  є в самому анонсі GGG. Відправлено на незалежне Opus-ревю.
- **Ранбук запуску ліги (Sonnet-трейс коду):** інжест бере ВСІ публічні ліги
  з дайджесту (`normalizeCxDigest` з `league:null`), виявлення в `/api/config`
  через `listPricedLeagues()`, `resolveLeagueAccess` пускає `?league=` поза
  env, якщо є свічки (c0d6c70, 01.08) — **env для Forbidden Rites міняти не
  треба; нотатка T3 у BACKLOG застаріла.** Ручне/рішення: `LEAGUE` (дефолт)
  скоупить 600+ SEO-сторінок і sitemap — на день 1 лишаємо Runes of Aldur;
  годинний снапшот будується лише для активної ліги → нова ліга на
  повільному on-demand шляху. Запущено: Opus — снапшоти для всіх priced-ліг
  (гілка `feat/snapshots-all-leagues`); Sonnet — `docs/LEAGUE-LAUNCH-RUNBOOK.md`,
  фікс BACKLOG T3, статус Phase 3 у SEO-плані.
- **Opus-ревю фіксу sitemap (свіжий контекст): MERGE WITH FIXES.** HIGH: нема
  `runtime="nodejs"` + `maxDuration=30` на тепер синхронному DB-читанні
  (лямбда-таймаут не ловиться try/catch → 5xx для Googlebot). MEDIUM:
  `swr=86400` віддає добову копію майже на кожен fetch — і старий роут уже
  слав ці ж CDN-заголовки, тож фріз міг бути частково на CDN, а не лише ISR.
  MEDIUM-LOW: кешування деградованої відповіді суперечить інваріанту в
  `http.js:5-6`. LOW: негерметичний тест (ambient DATABASE_URL), нема
  end-to-end тесту здорового шляху. Повернуто агенту-автору на виправлення.
- **Opus-ревю гайду: MERGE WITH FIXES.** HIGH: "Viridian Wildwood" — слова
  "Viridian" нема в жодному з трьох постів GGG (PoE1-назва з пам'яті моделі,
  порушення house rule про факти лише з джерел). MEDIUM: час лише "1 PM PDT",
  без ISO/UTC. LOW: не сказано, що ліга закінчується з 1.0 (FAQ GGG); третій
  повтор дисклеймера; жодного тесту на гайд. Повернуто автору; додаємо
  guard-тест на FAQPage JSON-LD + `startsAtIso`.
- **Docs (Sonnet):** новий `docs/LEAGUE-LAUNCH-RUNBOOK.md` (чекліст на 04.09 +
  автоматичне/ручне з file:line), BACKLOG T3 закрито як застарілий, статус
  Phase 3 + факти GSC у SEO-плані, лінк у docs/README. Голова дочистила другу
  застарілу нотатку "New leagues" у BACKLOG (розділ Data freshness).
- **Фікс sitemap після ревю — фінал:** `fix/sitemap-freshness` @ 92f46e8
  (amend). Додано `runtime="nodejs"` + `maxDuration=30`; здоровий шлях
  `public, s-maxage=3600` **без swr** (тест пінить відсутність директиви);
  деградований шлях — `Cache-Control: no-store` через `cacheHeader(200,
  {sMaxAge:0})`, інваріант `http.js` не порушено; тест роуту герметичний
  (`delete process.env.DATABASE_URL`). E2E-тест здорового шляху не додано —
  нема seam (`getCurrencyIndex` кличе `getSql()` напряму). 317/317, білд
  `ƒ /sitemap.xml`. Після деплою очікуємо `x-vercel-cache` MISS→HIT з age ≤3600
  і lastmod = поточна година; `no-store` у відповіді = деградація, видима.
- **Гайд після ревю — фінал:** `content/forbidden-rites-league` @ 7379a17.
  "Viridian" прибрано (у білді нуль згадок), формулювання механік звірено
  дослівно з прес-релізом; `startsAtIso: 2026-09-04T20:00:00Z` (зсув
  підтверджено FAQ GGG: "11:00 PM GMT+3"), `<time dateTime>`; в FAQ додано
  "триває до 1.0 і закінчується разом з Runes of Aldur" (без хардкоду дати);
  дисклеймер обрізано. `currentLeague`/`faqs` винесено в
  `apps/web/lib/league-start-guide.js`, новий `test/league-start-guide.test.js`
  (JSON-LD серіалізується, нема `undefined`/`</script`, ISO = анонсований
  момент, джерела лише pathofexile.com). 317/317, білд чистий.
  **Урок:** агент-автор узяв "Viridian" з ресерч-зведення Sonnet, а не з
  сирого джерела — факти для копі брати лише з raw HTML офіційного поста.
- **Снапшоти для всіх priced-ліг (Opus-агент):** `feat/snapshots-all-leagues`
  @ 066fee8, лише `radar-backend.js` + `test/radar-backend.test.js`.
  `refreshRadarSnapshots` → два проходи: активна ліга (без змін, поза
  бюджетом), потім `listPricedLeagues()` мінус вже зібрані і `(PLnnnnn)`;
  помилки ліги/дискаверi ізольовані в trace, не валять крон. Бюджет без
  нового таймера: `SNAPSHOT_BUDGET_MS=230s` + резерв max(60s, найдовший білд у
  цьому запуску) від `startedAt` роуту (300s). 5 нових тестів, 316/316.
  **Невідомо:** реальний час білду однієї ліги (нема історичних `elapsedMs`) —
  дивитись `snapshot.scope.end` у першому кроні після деплою. Відправлено на
  незалежне Opus-ревю з фокусом на бюджет і поведінку для свіжої ліги з 1–2
  свічками.
- **Інтеграційна суха злиття** (тимчасовий worktree у scratchpad,
  `integration-dryrun` = origin/main + три гілки): без конфліктів, **328/328
  тестів** (у симлінкованих node_modules падало 3 через відсутній `postgres` —
  артефакт середовища, після `npm install` у worktree чисто).
- **Opus-ревю снапшотів: MERGE WITH FIXES.** HIGH: гарантія "не вийдемо за
  300s" хибна — один білд ліги в найгіршому разі (18s op timeout × 2 спроби ×
  ~10 операцій) ≈ 320s, старт на 229s = вбита лямбда і втрачена телеметрія
  (активна ліга при цьому вже записана — дані не страждають). MEDIUM: реальна
  ціна ліги ~4× вища за оцінку (ще `listAnchorCandidates` 7-денний group-by),
  обидві гри, до 64 ліг. LOW: непарний trace `scope.skipped`; фільтр `(PL\d+)`
  строгіший за `leagueAvailability`. Повернуто автору: бюджет 120s, резерв
  max(60s, 1.5×worst), чесний коментар, парні trace-події.
- **Снапшоти після ревю — фінал:** `feat/snapshots-all-leagues` @ 866bab6.
  Бюджет 120s, резерв `max(60s, 1.5×worst)` (`snapshotLeagueReserve()`),
  чесний коментар про межі гейта і реальну ціну ліги, skipped → парні
  `scope.start`/`scope.end` з `skipped:"budget"` (тест звіряє трейси),
  `isPublicLeague` спільний з інжестом. 316/316.
- **Фінальна інтеграція** origin/main + 92f46e8 + 7379a17 + 866bab6: без
  конфліктів, **328/328**, білд чистий (`○ /guides/league-start-currency`,
  `ƒ /sitemap.xml`). Гілки НЕ змержені і НЕ запушені — чекає рішення Тараса
  (push у main = прод-деплой). Після деплою: перевірити lastmod sitemap,
  `snapshot.scope.end elapsedMs` у першому кроні, повторно подати sitemap у GSC.

**Дії Тараса:** дати добро на merge+push трьох гілок; увімкнути Vercel Web
Analytics; форумний тред pathofexile.com + каталоги; 04.09 — Reddit-пост і
перевірка `/api/config` на "Forbidden Rites".
- **Запит Тараса: "динаміка на все — валюти і ліги".** Sonnet-інвентар
  (file:line): ліги вже динамічні в інжесті/дискаверi, статичні лише дефолт
  `LEAGUE`, PoE1-фолбек-список, метадані PoE2-ліг (legacy endpoint ігнорує
  realm=poe2 → тільки OAuth T1), `currentLeague` гайду; валюти — git-снапшоти
  identity/catalog/gold/layout з PR-рефрешем за правилом чесності; невідомий
  Metadata id уже отримує рядок/сторінку/sitemap з humanized-ім'ям без іконки.
  Написано `docs/DYNAMIC-DATA-PLAN-2026-09.md`: A — ліги з власних даних
  (`league_meta`, дефолт з гістерезисом 48h/200 пар, env = override),
  B — identity у БД з RePoE/GGG static, C — layout/gold у БД за floors,
  D — офіційні метадані після T1. Рішення потрібні від Тараса (пороги, гейт
  чесності, порядок).

## 2026-09-02 (вечір) — "все так, го": merge + deploy, старт Phase A

- Тарас затвердив: пороги дефолтної ліги 48h / ≥200 пар; identity/layout/gold
  застосовуються автоматично за floors; порядок A → B/C → D.
- **Змержено в main і запушено** (8310f8e): докси + `fix/sitemap-freshness` +
  `content/forbidden-rites-league` + `feat/snapshots-all-leagues`. 328/328 на
  змерженому main (після `npm install` — у root node_modules не було
  `postgres`, той самий артефакт, що і в worktree). Vercel деплой запущено.
- Запущено Opus: **Phase A part 1** (`feat/league-meta`): міграція 009
  `league_meta`, `refreshLeagueMeta` одним агрегатом, чисте правило
  `chooseDefaultLeague` (48h/200 пар, тільки вперед, постійні ліги ніколи),
  резолвер env > db > fallback з TTL, всі читачі дефолту через нього, PoE1
  без хардкод-списку, нові поля в `/api/config`. Гайд — окремо (part 2).
- **Прод після деплою 8310f8e (READY 18:46Z), перевірено curl-ом:**
  sitemap `<lastmod>` = 2026-09-02T17:00Z (478 URL) — **розморозився з 29.08**;
  заголовки `cdn-cache-control: public, s-maxage=3600`, без swr; 635 URL.
  Гайд: 10× "Forbidden Rites", `dateTime="2026-09-04T20:00:00Z"`, "20:00 UTC",
  нуль "Viridian". `/api/config` activeLeague = Runes of Aldur (без змін).
  Снапшоти для всіх ліг перевіряються після крону 19:05Z (radar_snapshots
  poe2 Hardcore має оновитись).
- **Vercel Web Analytics** — Тарас увімкнув у дашборді; Sonnet підключив
  `@vercel/analytics@2.0.1` + `<Analytics />` у `apps/web/app/layout.jsx`
  (репо — один пакет, не workspaces; CSP нема). 328/328, змержено і запушено
  (424be3b). Перевірка скрипта `/_vercel/insights` на проді — фоном.
- GSC: Тарас на сторінці Sitemaps; повторна подача = той самий URL у поле +
  ПОДАТИ (востаннє прочитано 31.07).
- **Phase A part 1 готова (Opus):** `feat/league-meta` @ 08ca593, 348/348.
  Міграція 009 `league_meta` (RLS як 002, partial index на is_default);
  `refreshLeagueMeta` одним `group by league` по PK-префіксу (7-денне вікно;
  `first_seen_at` мержиться `least()` — не молодшає); `setDefaultLeague`
  атомарно в `sql.begin`; правило в `src/domain/league-meta.js` (постійні
  ліги як дані: Standard/Hardcore/Ruthless/SSF + префікси "HC "/"SSF "/
  "Hardcore "); резолвер `apps/web/lib/default-league.js` env > db > fallback,
  TTL 60s, 42P01 → трейс і fallback; крон `refreshLeagueDefaults` між інжестом
  і снапшотами; PoE1 без хардкод-списку; `/api/config` + firstSeenAt/
  lastSeenAt/pairCount/completedHours + `defaultLeagueSource`. Тест
  день-1 Forbidden Rites → без перемикання, через 72h → перемикання.
  Відправлено на Opus-ревю (фокус: латентність гарячого шляху, таймаут
  читання резолвера, 42P01 через retry-обгортки).
- **Opus-ревю Phase A: MERGE WITH FIXES.** HIGH: читання резолвера на
  гарячому шляху успадковує 18s timeout + retry×2 (до ~20s у бюджеті 30s),
  без `onTimeout` (висяча query тримає єдине з'єднання), без single-flight;
  env-override робить правило інертним, якщо `LEAGUE` виставлено (перевірено
  по `vercel env pull`: у проді є лише `LEAGUES`, `LEAGUE` нема — ок). MEDIUM:
  `resolveGameConfigs` резолвить обидві гри на кожен запит; PoE1 дефолт
  перемкнеться при першому кроні (прийнято як бажане, треба тест + "Ruthless"
  суфікс); `getConfig` і `getRadar` можуть розійтись у дефолті без свічок.
  LOW: колізія імен `src/domain/league-meta.js` vs `apps/web/lib/league-meta.js`
  → перейменувати на `league-default.js`. Повернуто автору.
- **Analytics live:** деплой 424be3b READY; у браузері `window.va` = function
  (компонент змонтований; тег скрипта вставляється клієнтом, тому curl по
  HTML його не бачить — поллінг "not live after 5 min" був хибним сигналом).
- **Крон 19:05Z після деплою снапшотів для всіх ліг — підтверджено з БД:**
  усі 11 ліг обох ігор (poe2: Runes of Aldur, HC Runes of Aldur, Standard,
  Hardcore; poe1: Standard, Allflame, Hardcore Allflame, Ruthless Allflame,
  HC Ruthless Allflame, Hardcore, Ruthless) мають `refreshed_at 19:05` — весь
  прохід уклався в бюджет 120s. Для Phase A це означає: PoE1-дефолт при
  першому кроні перемкнеться на Allflame (бажано), а "Ruthless Allflame"
  має бути виключений суфіксом — вже в списку правок автору.
- **Тайминги крону 19:05Z (Vercel logs):** увесь запуск 39,8 с (було ~30 с):
  інжест 10,9 с (poe2 1175 свічок, poe1 1980), активна Runes of Aldur 5,7 с,
  poe1 Standard 3,7 с, вторинні ліги 0,95–4,0 с кожна (Allflame 4,0 с з 2739
  рядками — найважча), сума вторинних ≈ 18 с. Бюджет 120 с має ~6× запас;
  оцінка "реальна ціна ліги невідома" закрита фактом.
- **Phase A після ревю:** `feat/league-meta` @ 8a96bbd, 351/351. Резолвер:
  `opTimeoutMs 2s`, `attempts 1`, `onTimeout resetSql`; single-flight через
  кешування in-flight promise (тест: 8 конкурентних → 1 читання);
  `resolveRequestedGame` резолвить лише запитану гру; "Ruthless " префікс +
  " Ruthless" суфікс постійні; тест PoE1 першого запуску: Standard → Allflame,
  Ruthless Allflame виключено; `bestPricedLeague()` вирівнює getConfig/getRadar
  (дефолт без свічок → найкраща ліга зі свічками, застосовується і до env-піна,
  трейс раз на TTL); перейменовано на `src/domain/league-default.js`;
  `.env.example` оновлено. Дельта-ревю відправлено рецензенту.
- **Дельта-ревю Phase A: MERGE** (351/351; резолвер 2s/1 спроба/resetSql на
  всіх request-шляхах, single-flight з identity-check при reset, невалідна гра
  — та сама помилка, unpriced-guard інертний доки Runes має пари; два
  прийнятні ризики лише за нуля пар у дефолті — фолоу-ап: фільтр public/
  permanent у last-resort reduce). **Змержено в main (6985783)**, міграція 009
  застосовується `supabase db push --include-all`, код пушиться.
- **Docs після Phase A (Sonnet):** ранбук переписано під data-driven дефолт
  (чекліст, автоматичне/ручне, верифікація через `defaultLeagueSource` і
  `league_meta`, rollback = env-пін); план Phase A — STATUS part 1 shipped +
  два прийняті фолоу-апи; BACKLOG "New leagues" уточнено. DECISIONS: новий
  запис про data-driven дефолт, попередній "тримати LEAGUE" позначено
  superseded.
- **Phase A на проді з 19:17Z:** `/api/config` віддає `defaultLeagueSource:
  "fallback"`, `activeLeague: Runes of Aldur` (таблиця порожня до крону 20:05Z —
  очікувано, поведінка для користувачів без змін). Фонова перевірка після
  20:05 покаже `league_meta` і перехід на `"db"`.
- Запущено **Phase B (Opus, `feat/cx-identity-db`)**: спільний модуль
  резолюції identity для скрипта і рантайму, міграція 010 `cx_identity` +
  pg_cron щоденно 04:20Z на `/api/cron/identity`, джоб з RePoE + GGG static
  (cap 200 id, таймаути), read-time merge DB > JSON > humanized через
  loader з TTL 10 хв, `identity` у `/api/status`.
- **Phase A part 2 готова (Opus):** `feat/guide-league-from-data` @ 422a8e8,
  359/359. `announcedLeague` (кураторські факти + `mechanics` — єдине місце
  прози), `pickGuideLeague(rows)` (наймолодша публічна непостійна за
  firstSeenAt), `resolveGuideLeague()` → announced / confirmed ("перша
  прайснута година на біржі") / observed (нова ліга з даних, без механік,
  чесна примітка); сторінка async + `revalidate 3600`, білд пререндерить
  (`○ 1h`); `buildFaqs(resolved)`. Фолоу-ап з ревю A закрито: last-resort у
  `bestPricedLeague()` — public non-permanent → public permanent → null
  (приватні ніколи). Відправлено на Opus-ревю.
- **Opus-ревю гайду з даних: MERGE WITH FIXES.** MEDIUM: "1 markets across 1
  completed hours" у копії і в JSON-LD (день-1 ліги — саме той випадок, для
  якого фіча). LOW: у observed лишилась фраза про "дві живі економіки";
  суфіксні HC/SSF-варіанти назв не фільтруються; reseed-hazard (7-денне вікно
  робить стару лігу "новою" після очищення таблиці) → guard 24h; продуктове
  рішення — в observed прибрати механіки з основного потоку під заголовок
  "Previously announced". Повернуто автору; ранбук: `currentLeague` →
  `announcedLeague`.
- **Phase B готова (Opus):** `feat/cx-identity-db` @ 1da37b8, 377/377 (+26).
  `src/domain/identity-resolve.js` спільний для скриптів і рантайму (байт-
  ідентичний вихід, offline round-trip тест на 40 id); міграція 010
  `cx_identity` + `cron.schedule('cx-identity-daily','20 4 * * *')` за
  патерном 008 (vault-секрет); джоб `identity-refresh.js` (distinct pair_id
  по PK-префіксу, cap 200, RePoE + trade static 10s×2, floors ≥1000/≥100,
  upsert без деградації полів); роут `/api/cron/identity` (той самий
  CRON_SECRET); loader `identity-overrides.js` (TTL 10 хв, патерн Phase A),
  `resolveCurrency(id, game, {overrides})`; wired у getRadar rebuild /
  снапшоти / hotlist; `/api/status.identity`. **Свідомо не підключено до
  currency pages / sitemap / OG:** вони ключуються short id, канонізованими
  при інжесті з committed JSON — нові identity не стають URL. Це межа Phase B
  для SEO; фолоу-ап B2 = канонізація при інжесті з БД (ризик зміни ключів
  свічок). На Opus-ревю.
- **Знахідка:** `.github/workflows/data-refresh.yml` існує лише локально —
  коміт 3560395 "untrack data-refresh workflow (push token lacks workflow
  scope)". Місячний PR-рефреш ніколи не крутився на GitHub; докси (BACKLOG,
  план) вважали його живим. Потрібно: Тарас пушить workflow з токеном зі
  scope `workflow`, або визнаємо, що страховки нема (Phase B її заміщає для
  identity; catalog/gold лишаються без автоматики до Phase C).
- Live `cron.job`: 1 prune-old-storage 03:17, 2 radar-ingest-hourly xx:05 —
  міграція 010 додасть третю (cx-identity-daily 04:20) через `cron.schedule`
  з ім'ям; перевірити ідемпотентність у ревю перед застосуванням.
- **Гайд з даних після ревю — фінал і деплой:** `1b90496` (plural helper;
  фраза про паралельну лігу лише для announced/confirmed; в observed —
  секція `<h2>Previously announced: …</h2>` з механіками; суфікси " HC"/
  " Hardcore"/" SSF" постійні; збережені прапорці isPublic/isPermanent як
  advisory-negative; reseed-guard: кандидат у межах ±2h від рухомого 7-денного
  floor або з <24 completed hours не стає observed/confirmed). 365/365.
  **Змержено (ff) і запушено разом з доксами (7b37c04).**
- **Opus-ревю Phase B: MERGE WITH FIXES** (377/377; 010 безпечна й
  ідемпотентна — `cron.schedule` за ім'ям як у 004; RLS як 009; ризик деплою
  LOW). MEDIUM: джоб сіє `observedIds`/`tradedIds` short id-ами замість
  Metadata-шляхів → таксономія гірша за скриптову і через DB > JSON назавжди
  перекриває кращу; фікс — reverse-map через `metadataForShortId()` + не
  писати category при `repo-class`/`unresolved`. LOW: `unresolvedObserved`
  насправді "рядки без іконки"; невикористані `overrides` у
  identityNames/Icons/Categories; `limit` не обмежує скан; серійні upsert-и
  (батчити); `getHotlist` вантажить overrides безумовно; round-trip тест не
  перевіряє category. **Підтверджено головну межу:** Phase B дає імена/іконки
  в радарі, hotlist і API, але **нуль нового SEO** — URL сторінок ключуються
  short id, канонізованими при інжесті з JSON; B2 = канонізація при інжесті з
  БД, з ризиком re-key `pair_id` (розрив історії) і карбування URL — має бути
  review-gated, не авто. Повернуто автору.
- **Хибна тривога 19:41Z:** усі curl до exileradar.com → 403
  `x-vercel-mitigated: challenge`, включно з POST на `/api/cron/radar`.
  Причина — Vercel System Mitigation (DDoS) поставив Challenge на наш IP
  37.46.252.23 після ~50 curl-запитів за кілька хвилин (поллінг sitemap/гайду).
  Attack Challenge Mode вимкнений, Bot Protection неактивний; запит з боку
  Vercel (`web_fetch_vercel_url`) → 200, браузер проходить; pg_cron і Googlebot
  не зачеплені. **Урок (у пам'ять):** прод перевіряти через Vercel MCP fetch
  або браузер, curl не частіше ніж раз на 30 с.
- **Гайд на проді після 7b37c04 (через Vercel-side fetch):** 200, режим
  "announced" (10× Forbidden Rites, 20:00 UTC, без "Previously announced");
  35 входжень "undefined" — усі `$undefined` у RSC-payload Next, у видимому
  тексті 0.
- **Phase B після ревю:** `feat/cx-identity-db` @ 27d0f8f, 382/382.
  `observedMetadataIds()` (reverse-map short id → Metadata через
  `metadataForShortId`, unbridged відкидаються) — експеримент: неправильний
  observed-set дрейфує 1056 категорій committed-мапи, правильний — 0;
  `TRUSTED_TAXONOMY_SOURCES`, інакше `category: null`; `iconlessRows`;
  сигнатури identityNames/Icons/Categories/isKnownCurrency повернуто,
  `identityWithOverrides` — єдиний bulk-merge, тестований; subcategory не
  деривується; upsert батчами по 50 (`sql(rows)`, coalesce збережено, новий
  `test/cx-identity-repository.test.js`); round-trip тест на всю committed-мапу
  (4355/4825 id, 0 розходжень; виключення — learned-prefix і дубль-імена,
  задокументовано). `getHotlist` без short-circuit — залишено з коментарем.
  Дельта-ревю відправлено.
- **Дельта-ревю Phase B: MERGE** (382/382; reverse-map коректний, coalesce в
  обидва боки, батчі без дублікатів сьогодні — захисний dedupe у
  `upsertCxIdentity` як фолоу-ап; round-trip тест не покриває seeding, але
  його покривають тести refresh). **Змержено в main (75741ae)**, 396/396.
  DECISIONS-запис Phase B виправлено (`iconlessRows`, subcategory null,
  guard rails, межа для SEO + B2). Міграція 010 застосовується, код пушиться.
