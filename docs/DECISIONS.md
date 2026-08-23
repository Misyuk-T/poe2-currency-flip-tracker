# Decision log (ADR-style)

Newest first. Each entry: **what** was decided, **why**, and the date.

## 2026-08-23 — SEO Phase 1: migration hygiene, and why `/` stays a redirect
Four changes, all from the Aug 16 ranking cliff post-mortem
(`SEO-RECOVERY-PLAN-2026-08.md`):

1. **`poe2-currency-flip-tracker.vercel.app` now 301s to exileradar.com**
   (`vercel.json` host-scoped redirect). It was serving 200 with full duplicate
   content; a canonical-only migration is fragile on a weeks-old domain.
   **`/api/*` is excluded on purpose:** the Supabase pg_cron ingest POSTs to
   that host (migrations 004/007) and pg_net does not follow redirects, so a
   blanket 301 would silently stop hourly ingestion. Migration 008 repoints the
   job at exileradar.com; the exclusion is removable once it is applied.
2. **`/` is a 308, not a 307** — a temporary redirect made every crawl
   re-evaluate the hop, so nothing consolidated onto `/poe2`.
   **Why not serve the landing at `/`:** it exists (`app/landing/page.jsx`) but
   is `noindex` with a canonical to `/landing`, and mounting it reverses the
   2026-06-29 decision to open straight to the dashboard while leaving a second
   copy at `/landing`. That is a product call, not migration hygiene.
3. **The sitemap moved from `app/sitemap.js` to `app/sitemap.xml/route.js`.**
   App-router *metadata* routes are emitted as build-time static output and do
   not honor `export const revalidate`, so all 639 `lastmod` values were frozen
   at the last deploy (Aug 8) while the data underneath moved hourly. A plain
   route handler gets real ISR — `next build` now reports `/sitemap.xml` with a
   1h revalidate. Deliberately **no** `dynamic = "force-static"`: if
   revalidation ever failed to engage that would reintroduce the same freeze,
   whereas degrading to per-request rendering only costs one snapshot read.
4. **Currency titles target `<item> price`** — the query pattern that actually
   converts in GSC, absent from the old "<name> PoE2 market tracker" title.
   Descriptions stay number-free: snippets are cached for weeks at this crawl
   rate, so a baked-in price would sit stale next to a freshness promise. Live
   figures remain in the body and JSON-LD only.

Head terms ("poe2 currency") are explicitly **not** targeted — they are held by
poe2scout / poe.ninja / GGG trade and are out of reach until real authority
exists.

## 2026-07-27 — Cold-read 502s: cascading timeouts + stale-while-revalidate, not a warm-up cron
Read routes were intermittently 502ing on the first request after an idle
stretch (always `cache=MISS`, always followed seconds later by a successful
retry). Two causes, both fixed in code rather than papered over:
1. The timeout limits were ordered **inwards**: the repository's app-level
   guard (10s) was tighter than the Postgres `statement_timeout` (8s→15s), so
   the database-side limit was unreachable and raising it alone would have
   changed nothing. They now cascade outward — **Postgres 15s → app guard 18s
   → route `maxDuration` 30s** — so a slow query dies with a real Postgres
   error, the app guard only fires on a silent connection, and the platform
   limit is the last resort. Read routes previously declared no `maxDuration`
   at all and inherited a default too tight for a cold start plus a fresh
   pooled connection.
2. Reads now lean on `stale-while-revalidate` (`s-maxage` 300→900, `swr`
   3600→86400) so the next visitor after idle gets the previous copy instantly
   while Vercel refreshes in the background. 15 minutes is still finer-grained
   than the hourly source, and staleness stays visible via `generatedAt`.

**Why not a warm-up cron** (pinging our own `/api/radar` every few minutes):
same outcome for visitors, but it adds a scheduled job whose only purpose is
to hide a cold path that we can simply fix. Worth recording since the idea was
considered seriously: it would **not** have touched GGG — it reads our own
database — so the "are we DDoSing GGG" concern was unfounded either way. GGG is
contacted only by the hourly ingest (~100 CDN requests/day).

## 2026-07-27 — Item icons: fallback chains derived from live data, never a curated list
A slice of CX items only have an icon URL derived from a RePoE art path, and
GGG's CDN 404s those; verified no URL rule recovers them (every extension,
realm and host variant fails, including poe2db's own CDN). Rather than
hardcode the affected items — which would go stale next league — each row now
falls back to a **working sibling from its own category**, computed from
whatever the API returned, then to an optional curated category glyph, then to
the neutral fallback. A shared `FallbackIcon` walks the chain on image load
errors, so which candidate resolves is decided by the browser at paint time
instead of guessed. **Why:** new leagues, items and item classes must work with
no code change. Logic lives in `apps/web/lib/icon-candidates.js` with unit
tests, including "a brand-new category from a future league needs no code
change". Verified across every game and league in production.

## 2026-07-25 — Gold-cost source: poe2db.tw scrape, not a formula
No gold-cost formula exists anywhere — verified directly against the official
Currency Exchange CDN response schema (no gold/tax/fee field in `markets[]`)
and against poe2wiki/poe2db (both are lookup tables, not formulas). GGG's own
design is a curated per-item table, so `src/data/gold-costs-poe2.js` stays a
curated table too, now sourced from a full scrape of
`poe2db.tw/us/Currency_Exchange` (664 items) matched by exact display name
against `catalog-poe2.json`'s trade short ids (651 matched, 13 omitted rather
than guessed). **Why:** the prior 9-item table's values matched this scrape
exactly, confirming the same lineage — this is a same-source expansion
(1.2% -> 86.3% catalog coverage), not a new, unverified source. `robots.txt`
on poe2db.tw allows crawling (`Allow: /`).

## 2026-07-21 — Currency Exchange goes live via the PUBLIC CDN (no OAuth)
GGG's OAuth team replied: CX history is now public through their CDN, so the
`service:cxapi` token we were waiting on is **no longer required**. Verified live
(probed 2026-07-21):
- Endpoint `GET https://web.poecdn.com/api/currency-exchange/<realm>[/<id>]`,
  unauthenticated, `realm=poe2` (also covers PoE1/xbox/sony). Response
  `{ next_change_id, markets[] }`; ~5-min delay.
- **`id` is a per-hour cursor; markets belong to the requested hour; `next =
  id+3600`.** Live edge: the in-progress hour returns `next === id` with empty
  markets (terminal). No-id returns the FIRST hour of ALL history (Dec 2024),
  NOT the latest — so `digestId = requested id`, and the OAuth `next-3600`
  derivation is WRONG for the CDN (mislabels the terminal hour).
- Real `market_id` = full **Metadata paths** (`Metadata/Items/<Class>/<Leaf>`,
  and the class varies: Currency, SoulCores, …). Ratios are **integer pairs**
  (`{A:2,B:1}` = 2A:1B); domain `ratioPrice = quote/base` already handles this.

**Decision: default `CXAPI_SOURCE=cdn`** (legacy OAuth kept behind
`CXAPI_SOURCE=oauth`). Go-live is a **3-phase BMAD cycle**, codex-reviewed each
phase:
1. **CDN provider + config gate (done, not activated).** New CDN provider,
   selector, contract + real-fixture tests. Live mode NOT enabled in prod.
2. **Identity/mapping layer (blocker).** Ingested candles store Metadata paths as
   base/quote, but the anchor config uses short ids (`exalted`) →
   `candleForAnchor`/`market-radar` match nothing → empty radar. Also the history
   route rejects `/` in pair ids. Must canonicalize Metadata → stable id at
   INGEST (anchors, shortlist, volume/stock JSON keys, names/icons), with an
   explicit migration/versioning policy since `pair_id` is in the candle PK. Live
   universe is ~627 currencies/league-hour; curated catalog resolves only ~6% by
   count (~42% by volume) — need a fuller Metadata→{name,icon,category} source.
3. **Canary + activation.** Isolated live-scope backfill, verify known ratios,
   exact league filtering (exclude Standard/HC/`PLxxxx`), row counts (~1.16M/30d),
   names/icons; then cron `:05`→`:10` and flip `PROVIDER_MODE=live`.

**Why phased, not a flag flip:** the CDN is live and correct, but the id-namespace
mismatch makes an unmapped activation produce a silently-empty radar. Provider
ships first (safe), activation waits on the mapping layer.

**Safety guard (Phase 1):** the CDN provider is always `configured` (public), so
a `PROVIDER_MODE=live` deploy no longer no-ops on a missing token. CDN live with
no cursor/`CXAPI_START_ID` now defaults to a recent backfill window (now −
`CXAPI_MAX_BACKFILL_HOURS`), never the Dec-2024 no-id crawl.

**Correction (same-day) — scope: PoE1 + PoE2 + ALL public leagues.** Original
plan tracked one game (poe2) + one league. Corrected: ingest **both games**
(PoE1 = no realm, PoE2 = `/poe2`) and **every public league**, since one CDN
stream per game/realm already carries all leagues in each hourly digest — the
data is there for free; filtering to one league threw most of it away.
- **Private leagues excluded.** The stream mixes in transient private leagues
  tagged `... (PLxxxxx)` (tiny, throwaway); `isPublicLeague` drops those, keeps
  permanent + challenge + HC/SSF variants.
- **Cursor is per (game, realm), NOT per league.** One stream feeds all leagues,
  so `cxapi_state` must key on game/realm (a coming migration), not league.
- **Impact on phases:** ingest becomes a per-(game,realm) loop; candles carry
  their own league (done in domain); storage writes per-candle league + a
  game/realm cursor; mapping is **per game** (PoE1 vs PoE2 item sets differ);
  the frontend needs a **game + league selector** (radar scope was single).
  Row volume grows (all public leagues × 2 games) — revisit retention/index
  budget in the canary.

**Correction (2026-07-21, Phase 3b) — canonical id = catalog SHORT ID at ingest.**
The earlier "canonical id = Metadata path" note is superseded now that a validated
map exists (RePoE, Phase 3a). Live CX Metadata ids are translated to the catalog
short id AT INGEST (`normalizeCxDigest({translate})`) where known, else the
Metadata path is kept. This makes the entire short-id-keyed downstream (anchor
matching, catalog/gold/display, history, SEO pages) work UNCHANGED for the
currency core, and keeps prod fixture identical (translator is a no-op for short
ids). Ratio/volume/stock are read from the ORIGINAL ids, then base/quote/pairId +
JSON keys use the canonical id. Translation is game-scoped (PoE2 only; PoE1 passes
through until it gets its own identity map).

Revised phase order: **1** CDN provider (done) → **2a** domain multi-league
(done, all public leagues, per-candle league) → **2b** storage/ingest rescope
(per game/realm cursor, per-candle league, migration) → **2c** multi-game ingest
loop → **3** identity/mapping per game (names/icons; the anchor-namespace
blocker) → **4** frontend game/league selector → **5** canary + activate.

## 2026-07-09 — Strategic pivot accepted (BMAD BA review): free tool, gold-wedge hero, apply for cxapi
Ran a BMAD-style business-analyst review of product-market fit. **User agreed with
all of it.** Fixed decisions:
- **Drop the $5/mo subscription premise.** Category price anchor is $0
  (poe.ninja / poe2scout are free), audience is small + league-seasonal, and a
  paid tier on GGG data/art likely conflicts with GGG's commercial-use permission.
  Model, if any, is **free tool + "buy me a coffee"/Patreon** — reputation asset,
  not revenue.
- **The gold-cost-aware wedge is the hero — BUT it is contested (see correction
  below).** "profit per 100k gold" / limiting-resource framing is the sharpest
  differentiator vs. the *giants*; promote it to the primary surface, demote
  radar/guides/paper-trade to support.
  **Correction (same-day BA follow-up):** the flip workbench is NOT a green field.
  poe.ninja owns the price-check reflex + builds; poe2scout owns PoE2-native depth
  + an open API (it's becoming *infrastructure* others build on). Both ignore the
  flipper's workbench — but the long tail already rushed in: **poe2fun.com** ships
  a gold-cost-aware flip calculator (literal "10K Gold Additional Cost" input),
  **exiledtools** ships a flip finder with ROI + liquidity, and **poe2scout-mcp**
  advertises arbitrage detection. So "we account for gold" is NOT unique. The wedge
  survives only on **(a) provable correctness of the gold model, (b) the
  gold-constrained *small* flipper persona nobody serves (~40k gold, where the tax
  kills a nominal 5% edge), and (c) an honest-but-decisive answer.** Next action:
  spend an hour in poe2fun + exiledtools and find exactly where their gold math is
  wrong/missing — that specific gap is the real opening, not gold-awareness in the
  abstract.
- **"Honesty / no-fabrication" is table stakes, not a moat** — keep it in the
  DATA, but stop being timid in the PRODUCT: ship a calibrated, labelled,
  backtested *decision signal* (e.g. "cleared within horizon in X of Y comparable
  past windows — historical, not a forecast") instead of only `null`/`insufficient`.
- **Two existential risks, both previously deferred:** (R1) live data needs a GGG
  `service:cxapi` OAuth grant not yet applied for; (R2) commercial use of GGG
  data + art needs written permission. Resolving both = **one email to GGG**,
  which gates everything.
- **Sequencing (user's call):** polish the dashboard + design into a beautiful
  demo FIRST, then send the GGG API-developer / cxapi application (a nice demo
  strengthens the outreach). Also queue: Google Search Console + privacy
  analytics for a real demand signal.
**Why:** work had been flowing to comfortable engineering (OG images, card grids)
and away from the two non-engineering unknowns that actually decide the outcome.
See [ADVICE.md](ADVICE.md) for the full assessment.

## 2026-07-09 — Gold-cost model is an honestly-labelled approximation (no public GGG formula)
Researched how PoE2's Currency Exchange charges gold. **Finding: GGG has not
published an exact formula.** The community-verified mechanic (PoE Wiki) is: gold
is charged **per order, only on placement** (lost even if you cancel), **per item
on the "want"/buy side**, and **scales linearly with the exchange ratio** (rarer/
pricier target ⇒ more gold per item); design intent is early-campaign anti-bot
friction, negligible in endgame. If the exchange finds a better rate you may get
gold+currency back (never more than you tried to buy). Our model
`gold_for_leg = ceil(received_quantity * goldPerUnit)` matches "per want-item ×
rarity"; the one honest gap is that real gold scales with the **live ratio**,
whereas `goldPerUnit` is a **static per-currency snapshot** (already labelled a
"versioned snapshot, not a permanent formula"). **Decision:** keep the current
model, keep it labelled an approximation; a later improvement is to scale gold by
the live exchange ratio rather than a static table — but GGG's exact constant is
not public, so any formula stays an explicit approximation (fits the honesty rule).
Sources: poewiki.net / poe2wiki.net "Currency exchange market", maxroll, mobalytics.

## 2026-06-29 — Code review runs through codex with GPT-5.5
Pre-commit code review is delegated to the **codex MCP using model GPT-5.5**
(workspace review): it independently greps for broken references, runs
`npm test` + `next build`, and reports PASS / WARN / FAIL before we commit.
**Why:** an independent second model catches dangling refs and build breaks a
single pass misses; GPT-5.5 is the agreed reviewer tier. Applied to the
backend-removal change below.

## 2026-06-29 — Removed the legacy standalone Node backend + opportunity engine
Deleted the always-on Node HTTP server (`src/server/index.js`/`app.js`), its
opportunity engine (`snapshot`, `constraints`, `order-book`, `offers`,
`opportunities`, `executable-quote`, history store), the old static `src/public/`
UI, the now-unused providers/storage (`fixture`/`ggg-exchange`/`market-provider`/
`rate-limit`; `local`/`supabase`/`hourly`/`storage-provider`), the `dev`/`start`
npm scripts, and the 26 tests that only covered the above — 24 src files +
`src/public/` + 26 tests. Kept the radar pipeline `src/` subset that Next reuses
(`config`, `radar-core`, `radar-ingest`, `domain/*`, `radar-repository`,
`ggg-cxapi-provider`). Catalog icon output moved `src/public/icons` →
`apps/web/public/icons`. **Why:** the deployed product is serverless (Next
`/api/*` + cron) and provably imports none of the removed files; `yarn dev`
launched a confusing stale UI. Codex (GPT-5.5) review: no FAIL, `npm test` 66/66
and `next build` green. Supersedes the 2026-06-24 "always-on `src/server` is
local-dev only" note.

## 2026-06-29 — Root `/` temporarily redirects to the dashboard (landing hidden)
`app/page.jsx` now 307-redirects to `/poe2`; the marketing landing moved to
`app/landing/page.jsx` (route `/landing`, `robots: noindex`), and the sitemap
lists `/poe2` (priority 1) instead of the redirecting root. **Why:** for outreach
to the GGG API developers the site should open straight to the working dashboard,
not a marketing page. Reversible: move `landing/page.jsx` back to `page.jsx` and
drop the redirect.

## 2026-06-27 — Homepage = two-column hero matching the approved reference
The landing is a left-aligned hero (serif headline, gold accent line, gold CTA)
beside one cohesive dark MARKET RADAR panel (movers rail with real sparklines +
gold range chart + CURRENT/CONSERVATIVE PLAN). Replaces the centered single-
column hero. Gold is the cohesive accent (amber chart + observed price). The
homepage rail opts into `includeStale` so it is never empty (data is labelled +
its age is shown). **Why:** match the design the user approved; co-reviewed with
codex and verified live.

## 2026-06-27 — Light-theme cards: uniform width + auto-fit grids
All `.content-section` cards are full-width (prose text constrained inside for
readability) so card edges align. `.currency-grid` uses `auto-fit`; icon grids
(index/related) opt into a wider min via `:where(:has(> .with-icon))` —
`:where()` keeps specificity low so the mobile `@media` 1fr override still wins.
**Why:** prose cards were ~820px vs full-width data cards (ragged edge); fixed
3-col grids left lone-card rows; `.with-icon` cards ran name+summary inline.
Browser-verified + codex-reviewed.

## 2026-06-27 — Stay on sample/fixture data until cxapi OAuth
**Superseded by the 2026-07-21 entry above** — GGG made the CDN public, so the
OAuth grant this decision was blocked on is no longer required; live-data
go-live is in progress.

Live GGG `service:cxapi` data is **not** pursued yet (user choice). The app runs
on labelled fixture data; C2b (cxapi activity ordering), D5 (serverless
opportunities) and SEO P3 (drop "sample data" labels) stay blocked on the OAuth
grant. **Why:** the OAuth application is a separate track the user has not
started; sample data is honest and sufficient to build the product surface.

## 2026-06-27 — Auth = Google sign-in via Supabase Auth (C3c)
The per-user track (paper-trade forward journal) will use **Supabase Auth with
Google** as the sign-in method (user confirmed; Supabase supports it natively).
Discord is deferred. **Why:** Supabase Auth is already the data layer's auth
mechanism; Google is the lowest-friction provider to enable. The forward-journal
table + per-user RLS land with this track.

## 2026-06-27 — Custom domain: buy one (pending choice)
Decided to move off `*.vercel.app` to a custom domain for trust/CTR. Options and
purchase advice tracked in [ADVICE.md](ADVICE.md). **Why:** a branded domain is
a measurable SEO/trust win; `NEXT_PUBLIC_SITE_URL` + canonical/sitemap/OG already
read from one env var, so the switch is low-effort once the domain exists.

## 2026-06-27 — Paper-trade engine resolves by DATA COVERAGE, not wall clock
`evaluatePaperTrade` marks a trade `entry-missed` / `open-at-horizon` only once
observed candles reach the horizon end; a take-profit only fills on an hour
*after* the entry filled (intrahour order is unknowable from hourly low/high).
**Why:** anything else fabricates outcomes/ordering — violates the honesty rule.
The backtest on currency pages is labelled a simulation on sample data, not
advice (it currently shows the naive strategy *losing*, which is the point).

## 2026-06-27 — Edge caching via `Vercel-CDN-Cache-Control`
Read routes are `dynamic = "force-dynamic"`, and a bare `Cache-Control: s-maxage`
was **not** honoured by Vercel's CDN (verified live: MISS twice). Switched to
`Vercel-CDN-Cache-Control` + `CDN-Cache-Control` for the edge and
`public, max-age=0, must-revalidate` for the browser. **Why:** verified live
MISS→HIT; errors/degraded responses stay `no-store`.

## 2026-06-27 — `/api/radar` payload trimmed to tradable rows
The serverless `getRadar` drops no-trade catalog placeholder rows (~575 KB →
small). **Why:** every browser consumer already filters them; `trackedCount` /
`catalogCount` still report the full picture. Domain `buildRadarResponse` is
unchanged (keeps the full representation for its tests).

## 2026-06-27 — Sitemap lists only data-backed currencies; no churning lastmod
The sitemap unions popular + every currency with stored data; pages without data
carry no `lastModified`. **Why:** avoids hundreds of thin, near-duplicate pages
and avoids a `lastmod` that churns to "now" every hour (which trains crawlers to
ignore it).

## 2026-06-24 — Serverless production (Variant B): Vercel + Supabase
Production runs **no always-on Node server**. Compute is Vercel Cron + Next.js
Route Handlers (Node runtime); Supabase Postgres is the durable layer; reads are
server-side only, RLS deny-all. The always-on `src/server` is local-dev only.
**Why:** decided with a codex architecture review; avoids a runtime port (Deno)
and an always-on host. (See NEXT_STAGE_PLAN Phase D.)
