# Decision log (ADR-style)

Newest first. Each entry: **what** was decided, **why**, and the date.

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
