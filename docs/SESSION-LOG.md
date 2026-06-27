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

**Next (queued):** critical UI/responsive polish pass (paddings/overlaps),
dynamic OG images, keyword guide pages, C3c (Google auth) foundation prep,
custom-domain purchase + wiring.
