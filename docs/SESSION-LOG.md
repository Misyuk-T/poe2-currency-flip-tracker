# Session log

Newest first. One block per working session: what changed + commit refs.

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
