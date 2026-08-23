# SEO recovery & content plan — August 2026

Working plan for the impressions cliff + pre-0.5.5 content push. Execute top-down;
review between phases (per project convention — Codex quota resets Aug 27, an
independent subagent review of v1 of this plan is already incorporated below).
Companion to `SEO_PLAN.md` (the living checklist); items graduate there as they
ship.

## Facts (verified 2026-08-23)

**Search Console, last 3 months (exileradar.com property):**
- 41 clicks / 3.3K impressions / avg position 29.3 / CTR 1.2%.
- Clicks come almost entirely from long-tail `<item> price` queries
  ("katlas gloom price", "idol of ralakesh price", "thruds might price").
- Head terms ("poe 2 currency" 41 imp, "poe2 currency" 22, "path of exile 2
  currency" 15) get 0 clicks — page 3+. **Held by poe2scout / poe.ninja / GGG
  trade: out of scope until post-1.0 authority exists.**
- Brand query "poe2 radar" exists (top clicked query).
- Impressions on this property start from ~0 on Jul 27–29 → the exileradar.com
  domain went live ~late July (SEO_PLAN recorded the canonical origin as
  `poe2-currency-flip-tracker.vercel.app` as recently as Jun 27).
- **Impressions cliff:** ~119–150/day Aug 12–15 → 48 on Aug 16 → 6–9/day after.

**League calendar (web research, 2026-08-23):**
- Current league: Runes of Aldur (0.5.0 "Return of the Ancients"), launched
  2026-05-29, still running — no official end date.
- 0.5.5 expected ~mid-September; reveal likely around Gamescom (Aug 26–30).
- ExileCon Nov 7–8; 1.0 full release predicted ~Dec 11 — the biggest
  search-demand event PoE2 will ever have.

**Prod checks (curl, 2026-08-23):**
- Pages 200, canonical → exileradar.com (correct), robots.txt + sitemap present.
- Page data is FRESH ("As of completed hour 2026-08-23T15:00Z") — ingestion fine.
- **`/` is a 307 temporary redirect to `/poe2`** — bad target for the backlink
  push (people link the bare domain) and muddy canonical for the brand query.
- **The old `poe2-currency-flip-tracker.vercel.app` still serves 200 with full
  duplicate content** — no 301 to exileradar.com; only the canonical tag points
  across. A canonical-only migration on a weeks-old domain is fragile.
- All 639 sitemap URLs have `lastmod` frozen at 2026-08-08. The sitemap's DB
  read succeeded at generation time (the fallback path emits only ~popular
  currencies with no lastmod, so a full 639-URL map ⇒ DB was fine). Likely
  cause: Next.js app-router metadata routes (`sitemap.js`) are emitted as
  build-time static output — `export const revalidate = 3600` is not honored
  for them in several Next versions — so lastmod freezes at every deploy.
  Last deploy ≈ Aug 8.

## Phase 0 — Diagnostics: DONE 2026-08-23 (GSC checked directly in Chrome)

**Verdict: site-wide algorithmic demotion, not demand decay.**

Measured in GSC (compare Aug 17–23 vs Aug 9–15):
- Clicks 11 → 0. Impressions 916 → 34 (−96%). Avg position 37.2 → 69.5.
- Every tracked query dropped to ZERO impressions after Aug 16 — including the
  brand query "poe2 radar" (was position 8.3) and top-10 long-tail
  ("olroth saga poe2 price", position 8.5). Head terms fell from position
  ~47–86 to below top-100.
- **Manual actions: none. Security issues: none.** (both reports clean)
- **Indexing stable through the cliff:** 336 indexed / 303 not indexed; no
  drop in the indexed count around Aug 16. Of the not-indexed: 280
  "Discovered – currently not indexed" (Google declines to crawl ~half the
  long tail), 19 crawled-not-indexed, 4 redirect pages (the Aug 8 GSC message
  is about these).
- **External links known to Google: 0.** Zero linking sites, zero anchors.
  Internal links: 666.
- Google Search Status dashboard: **August 2026 spam update ran Aug 18–21**.
  Cliff started Aug 16–17 (GSC dates are Pacific-time; effect slightly
  precedes the announced start, so the update may have reinforced but likely
  didn't initiate).

**Root cause (high confidence):** a ~4-week-old domain with 639 programmatic
pages and literally zero external links lost its new-site honeymoon ranking.
Nothing holds the rankings up. Recovery = authority (links) + on-page
relevance + migration hygiene; there is no penalty to "lift".

Remaining (needs Taras, non-blocking): date the vercel.app→exileradar.com
switch in Vercel domain history; deploy current work (prod is a ~Aug 8 build).

## Diagnosis of the Aug 16 cliff (confirmed)

1. **Honeymoon expiry on a zero-authority domain** (confirmed by: 0 external
   links, site-wide uniform collapse incl. brand, no penalty, stable index).
2. **Aug 2026 spam update (Aug 18–21)** — plausible reinforcement, timing 1–2
   days after the cliff began.
3. Late-league demand decay — minor contributor only (demand fell ~nothing
   like 96%).

Not the cause: manual action, security, deindexing, site downtime,
canonical/robots.

## Phase 1 — Migration hardening + on-page fixes (~1–2 days of code)

**STATUS 2026-08-23: implemented on branch `seo/phase1-migration-onpage`
(6 commits off origin/main), Antigravity-reviewed CLEAN, 302/302 tests green.
NOT merged/deployed yet.** Notes: the vercel.app 301 excludes `/api/*` because
Supabase pg_cron posts the hourly ingest to the old host and pg_net does not
follow redirects; migration `008_radar_ingest_cron_canonical_host.sql`
(NOT applied) repoints the cron at exileradar.com — apply it after deploy,
then the `/api/` carve-out can be dropped. Root kept as redirect (now 308,
not content) — mounting the landing at `/` would reverse the documented
open-straight-to-dashboard decision; that's a product call, deferred.

Migration first — it's the top cliff suspect and cheap to fix:

- [ ] **301/308 the old vercel.app domain to exileradar.com** (Vercel project
      domain settings: mark exileradar.com as primary with redirect). Kills the
      live duplicate.
- [ ] **Fix the root:** serve real content at `/` (or at minimum a permanent
      308 instead of 307) before any backlink push.
- [ ] **Fix sitemap freshness:** move from the `sitemap.js` metadata route to a
      plain route handler (`app/sitemap.xml/route.js`) where `revalidate`
      actually works; verify on a preview deploy that lastmod moves.

Then titles/copy, targeting the query pattern that already converts
(`<item> price`) — explicitly NOT chasing head terms:

- [ ] **Titles:** `${name} PoE2 market tracker` → `${name} Price — PoE2 Hourly
      Market Data`. "Price" is absent today while present in nearly every
      converting query. No "(Live)" filler; verify the boilerplate reads
      correctly for non-orb exchange goods (the converting queries are items,
      not classic currency).
- [ ] **Descriptions: stable wording, no live number.** ISR + slow recrawl at
      this authority means a baked-in price would sit stale in SERPs next to a
      freshness promise (and Google rewrites most descriptions anyway). Use
      "Hourly price, range and 24h move for <name> in Path of Exile 2." Keep
      live numbers in body content and JSON-LD only.
- [ ] **H1 / intro copy** includes "price" naturally.
- [ ] **League-qualified copy** on dashboard + currency-index pages only (not
      600 pages — avoid churn): league name rendered dynamically (mirror the
      PoE1 live-league-metadata approach) so 0.5.5 renames itself.
- [ ] **Purge "sample data"/fixture wording** from prod-visible copy — data is
      live; search snippets still show fixture wording on guides.
- [ ] **Thin-page audit (feeds hypothesis 2):** list long-tail pages with 0
      impressions in 3 months AND no distinguishing content; decide
      consolidate/noindex rather than keep 639 near-duplicates.

## Phase 2 — Distribution round 1 + content (next ~2 weeks, before 0.5.5)

**STATUS 2026-08-23: the league-start guide is implemented on branch
`seo/phase2-league-start-guide` (2 commits off origin/main),
Antigravity-reviewed CLEAN, 299/299 tests green. NOT merged/deployed yet.**
League facts isolated in one `currentLeague` const for a one-line 0.5.5
refresh. Remaining Phase 2 items (forum thread, directories, trends page,
ratio guides) still open — the distribution items need Taras (forum/Reddit
accounts).

Distribution moved up: at near-zero authority, links are the binding
constraint, and evergreen backlinks need lead time. Do not wait for 0.5.5:

- [ ] **Official pathofexile.com forum tool thread** — the classic evergreen
      backlink every PoE tool has. Ship right after Phase 1.
- [ ] **Tool directories:** poewiki tools page, awesome-poe style lists, trade
      Discord communities.

Content, published before the 0.5.5 spike so it has indexation age:

- [ ] **League-start currency guide at an evergreen slug**
      (`/guides/league-start-currency` — no version/league in the URL; the URL
      accumulates authority across 0.5.5 and 1.0, poe.ninja-style). Refresh
      title/content per league once the name is announced (Gamescom). Biggest
      content bet.
- [ ] **Weekly movers / trends page** (auto from our hourly data, ISR daily):
      genuine freshness + internal links to every mover's page. Was SEO_PLAN
      P3; live data unlocks it.
- [ ] **2–3 ratio guides** mirroring the one that works (divine-to-exalted:
      131 imp): picked from GSC query data. On-page FAQ text for long-tail
      matching — but don't count FAQ JSON-LD as a lever (FAQ rich results have
      been restricted to gov/health sites since Aug 2023; markup is harmless,
      value is the text).
- [ ] **Internal links:** radar dashboard rows → currency pages.
- [ ] All content honest, data-backed, no fabricated market claims (house rule).

## Phase 3 — 0.5.5 launch window (~mid-Sept)

- [ ] **Reddit r/PathOfExile2 post on launch day**: "free currency radar,
      hourly prices, no login" — the moment everyone needs prices and
      incumbents' league data is thin.
- [ ] **OG images with sparkline/trend** (no precise baked-in number — Discord/
      Twitter cache cards for days). Social CTR where PoE tools actually
      spread; zero ranking effect, hence scheduled here, not Phase 1.
- [ ] **No Google Ads.** Free product, no monetization → paid clicks are pure
      burn and stop with the budget. Revisit only if a paid tier exists.

## Phase 4 — 1.0 readiness (Nov–Dec)

- ExileCon Nov 7–8, 1.0 predicted ~Dec 11. 1.0 dwarfs every prior demand spike;
  Phases 0–3 are the rehearsal. Freeze risky changes before launch week, prep a
  1.0 day-one page, repeat the Phase 3 distribution play.

## Measurement

Confounder-aware (Gamescom Aug 26–30 will move all PoE2 volume independently):

- Use the brand query ("poe2 radar") as a control series; evaluate per-query
  CTR only where position is stable; exclude the last 3 days of GSC data
  (finalization lag).
- Success criterion = impressions/clicks during the 0.5.5 launch window vs the
  July baseline — not "recovery to ~130/day" in the dead late-league weeks.
- Weekly: indexed-page count, sitemap lastmod actually moving, vercel.app
  redirect still in place.
