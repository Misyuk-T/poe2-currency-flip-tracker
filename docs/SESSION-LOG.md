# Session log

Newest first. One block per working session: what changed + commit refs.

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

**Next: 4** frontend game/league selector, **5** canary + activate (with the 60s
ingest bounded-budget fix). Known residual (backlog): finiteNonNegative(null)===0;
truly-unknown-to-RePoE ids render raw (rare — rebuild map).

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
