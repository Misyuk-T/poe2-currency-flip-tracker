# SEO plan — PoE2 Currency Flip Tracker

Living checklist. We implement against this, top-down by priority. Non-commercial
for now (no paid tier), so framing/keywords target free community use.

## Goal
Rank for PoE2 currency price / market / flipping queries, land organic visitors
on data-backed pages, and funnel them into the radar dashboard.

## Principles
- Key pages are **crawlable static/ISR HTML with real data** (no JS-only content).
- **Honest labelling** ("sample data" until the live cxapi feed is enabled).
- **One indexable page per currency**, refreshed hourly from our own table.
- Don't sacrifice the dashboard for SEO or vice-versa — connect them.

## Done
- [x] ISR currency pages `/poe2/currencies/[id]` — server-rendered latest hour
      (midpoint, range, 24h move, samples) + JSON-LD, `revalidate = 3600`.
- [x] Static homepage `/`, dashboard `/poe2`, guide, `sitemap.xml`, `robots.txt`.
- [x] Same-origin API; hourly ingestion populates the data the pages read.

## Backlog (prioritized)

### P0 — correctness (do first)
- [ ] **Set `NEXT_PUBLIC_SITE_URL`** in Vercel to the production origin and redeploy.
      Currently canonical / `sitemap.xml` / `robots.txt` / OG all emit
      `http://localhost:3000` — actively harmful for indexing.

### P1 — high value
- [ ] **Wire `?currency=<id>` deep-link** in the dashboard so currency-page CTAs
      preselect the market (closes the SEO→app loop).
- [ ] **Data-backed `/poe2/currencies` list** — each card shows price + 24h move
      (reuse the slim currency-summary reader), ISR hourly.
- [ ] **Homepage mini-radar** under the hero: small client widget showing top
      movers from `/api/radar`. Page stays static; widget hydrates after load.
- [ ] **Unique per-currency copy** — a few sentences of genuinely useful, distinct
      text per currency (what it's used for, how it trades) + an FAQ block.
- [ ] **Sitemap completeness** — include all catalog currencies (not just the 6
      popular), with `lastmod` from the latest completed hour.
- [ ] **Breadcrumb JSON-LD** (`Home › Currencies › <currency>`).

### P2 — growth & polish
- [ ] Keyword landing/guide pages: "how to flip X", "divine to exalted ratio",
      "poe2 currency exchange explained".
- [ ] Dynamic OpenGraph images per currency (price + sparkline) for social CTR.
- [ ] Caching headers (`s-maxage` / stale-while-revalidate) on read routes; trim
      the `/api/radar` payload (drop no-trade rows) — bandwidth + speed.
- [ ] Internal linking: home → currencies → radar; cross-link related currencies.
- [ ] Privacy-friendly analytics + **Google Search Console** (verify domain,
      submit sitemap, watch impressions/CTR per currency).
- [ ] **Custom domain** — better trust/CTR than a `*.vercel.app` subdomain.

### P3 — after live data (cxapi OAuth)
- [ ] Drop the "sample data" labels once real prices flow — real, fresh prices are
      the single biggest content-quality / trust / SEO unlock.
- [ ] Trend/summary pages (weekly movers, ratios over time) for long-tail queries.

## Keyword themes
`<currency> price poe2` · `poe2 <currency> to exalted` · `poe2 currency exchange`
· `poe2 currency flipping` · `poe2 divine orb price` · league-qualified variants.

## Measurement
- Search Console (impressions, CTR, position per currency page).
- Core Web Vitals (the pages are static/ISR, so this should stay green).

## Notes
- Real cxapi data depends on a GGG OAuth `service:cxapi` grant (separate track).
- Keep everything honest; "sample data" labels stay until the live feed is on.
