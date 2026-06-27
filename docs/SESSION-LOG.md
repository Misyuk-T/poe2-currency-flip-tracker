# Session log

Newest first. One block per working session: what changed + commit refs.

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
