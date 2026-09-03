# Thin-page audit — September 2026

Closes the unstarted Phase 1 item in `SEO-RECOVERY-PLAN-2026-08.md`: *"list
long-tail pages with 0 impressions in 3 months AND no distinguishing content;
decide consolidate/noindex rather than keep 639 near-duplicates."*

Measured against production on **2026-09-03**, read-only, via
`supabase db query --linked`. Scope: `game=poe2`, `realm=poe2`,
`league='Runes of Aldur'` (the `league_meta.is_default` row), `provider=live`,
anchor `exalted` — the exact scope `getCurrencyIndex` and `getCurrencySummary`
resolve to.

---

## Verdict

**The thin-page premise is disproved. Do not noindex the long tail.**

- **84% of currency pages have three days or more of hourly price history**;
  only 26 of 627 (4.1%) have under half a day. There is no population of
  hundreds of empty pages to remove.
- The only depth measure both the sitemap and the page can compute — `samples` —
  **measures the wrong thing**, and a threshold on it would have deindexed
  precisely the wrong pages. See "Why the threshold was rejected".
- **Shipped instead:** one narrow, unambiguous fix — eight URLs that 404 are no
  longer advertised, and the pages behind them no longer claim a canonical that
  does not resolve. 628 → 620 currency URLs in the sitemap.
- **The real problem this audit surfaced:** `/poe2/currencies` links **6 of 628**
  currency pages. The long tail has essentially no internal links, so the sitemap
  is its only discovery path. That is the far more plausible mechanical reason
  Google discovered 280 URLs and declined to crawl them, and it is being fixed on
  another branch.

## 1. What the site publishes today

| | count |
|---|---|
| Sitemap URLs total | 636 |
| — static + guides (`/poe2`, `/poe1`, `/poe2/currencies`, `/guides`, 4 guides) | 8 |
| — currency pages | 628 |
| Currency rows in the stored `exalted` radar snapshot | 627 |
| Popular currencies always listed (one, `exalted`, is the anchor and has no row) | 6 |

A currency has earned a sitemap entry since 2026-06-27 the moment it had any
stored candle (`docs/DECISIONS.md`, "Sitemap lists only data-backed
currencies"). The audit set out to tighten that bar; the measurements below are
why it stays as it is.

Search Console context (checked 2026-09-03): 325 indexed, 314 not indexed, of
which **280 "Discovered – currently not indexed"** and 30 "Crawled – currently
not indexed". External links: **0**. Domain age ~5 weeks.

## 2. Data depth, measured

### Retention shapes what is measurable

`prune_old_storage` keeps **7 days** of `hourly_market_candles`
(`supabase/migrations/20260801132323_reduce_radar_storage_egress.sql`), so
"impressions in 3 months" and "90-day depth" are not answerable from our own
data — the deepest market in the window has 173 completed hours.

The radar read is bounded again on top of that: `readCandleWindow` takes the
**newest 25 stored hours per pair** (`MAX_HOURS_PER_PAIR`,
`src/storage/radar-repository.js`). Everything downstream of the stored
snapshot — including the sitemap — therefore cannot see further back than about
a day.

### Distribution A — distinct priced hours across the whole 7-day window

The honest answer to "does this page have history". Not usable by a shared rule
(the sitemap cannot see it), but it is what settles the premise:

| priced hours in 7 days | pages | share |
|---:|---:|---:|
| 1–2 | 7 | 1.1% |
| 3–5 | 5 | 0.8% |
| 6–11 | 14 | 2.2% |
| 12–23 | 22 | 3.5% |
| 24–47 | 55 | 8.8% |
| 48–119 | 123 | 19.6% |
| 120–173 | 401 | 64.0% |

### Distribution B — `samples`: priced hours in a market's own last 24 hours

The number the currency page prints on its "Samples (last 24h)" card, and the
only depth measure available identically to both the page and the sitemap.

| samples | pages | share | cumulative |
|---:|---:|---:|---:|
| 1 | 16 | 2.6% | 16 |
| 2 | 15 | 2.4% | 31 |
| 3–5 | 43 | 6.9% | 74 |
| 6–11 | 92 | 14.7% | 166 |
| 12–17 | 82 | 13.1% | 248 |
| 18–23 | 105 | 16.7% | 353 |
| 24–25 | 274 | 43.7% | 627 |

### Signals that turned out not to discriminate

| candidate signal | result |
|---|---|
| "appears in the exchange layout" | **627 / 627** rows resolve `layoutSource: "game-client-layout"`. Universal — useless as a filter. |
| "has a real name, not a humanized Metadata leaf" | 619 / 627 ids are in the committed `catalog-poe2.json`. The other 8 are the broken-URL group in §4, already caught by URL shape. |
| staleness / recency | Max age since last print is 120h and only **3** rows exceed 72h. Adds nothing, and would make `robots` flap hour to hour. |
| `stale` flag (>2h since last print) | 196 rows — 31% of the site. Normal for illiquid markets, not a thinness signal. |

## 3. Why the threshold was rejected

A `samples < 3` rule was built, measured (39 of 636 URLs) and then **withdrawn on
review**. Three findings killed it:

**1. `samples` scores the wrong markets.** It counts priced hours in the 24 hours
before a market's **own latest priced hour**. A market that stopped trading
months ago keeps its last healthy count and stays indexed forever; a market that
appeared yesterday is scored 1. The rule therefore catches **new** listings, not
dead ones. The concrete casualties: `temporalis`,
`the-arbiters-reliquary-key`, `aldurs-saga` — which is exactly the shape of the
`<item> price` queries that produce nearly all of this site's clicks (`"olroth
saga poe2 price"`, `"katlas gloom price"`, `"idol of ralakesh price"`).
Deindexing those is worse than doing nothing.

**2. The launch case makes it actively harmful.** 25 markets in this league's
history took **over 24h** to reach three priced hours; the worst took **102h**.
With `/poe2/currencies` linking 6 of 628 pages, the sitemap is the only
discovery path a new item has, so the rule would hide brand-new items for days —
during the exact week they are most searched.

**3. The stated justification was thin.** "The page renders — for its 24h move"
is not evidence that a reader was harmed, and we have no impression data for
these URLs at all (they were never crawled). Hiding pages on that basis is not
supported.

### If a threshold is ever revisited

Keep these measurements; they are the starting point.

| `samples` threshold | URLs hidden (of 628) | share |
|---:|---:|---:|
| 2 | 24 | 3.8% |
| 3 | 39 | 6.2% |
| 4 | 57 | 9.1% |
| 5 | 68 | 10.8% |
| 6 | 82 | 13.1% |
| 8 | 114 | 18.2% |
| 10 | 139 | 22.1% |
| 12 | 174 | 27.7% |
| 16 | 228 | 36.3% |
| 20 | 274 | 43.6% |
| 24 | 357 | 56.8% |

Three notes for whoever picks this up:

- **A different measure is needed.** Any future rule must key on *absolute*
  recency (hours since the market's last print, against the clock) rather than a
  window anchored on the market's own latest hour, and must exempt markets whose
  first-ever candle is recent, or it will repeat mistake 1 above.
- **Hysteresis is not needed.** 43 pages sit at `samples` 3–5, i.e. within two
  prints of a threshold of 3 (an independent read an hour later counted 41 —
  the band moves by a page or two per hour), and measured churn is roughly
  **12 flips per day across ~650 markets**. That is well inside what an hourly
  ISR page and a per-request sitemap can absorb without a damping band.
- **The two readers do not agree instantaneously.** It is tempting to argue that
  the page (which reads 7 days) always sees at least what the stored snapshot
  (newest 25 hours) sees, so a `noindex` page could never be advertised in the
  sitemap. That holds only at *equal freshness*, and the two readers are cached
  independently — the snapshot is rewritten hourly by cron, the page is ISR at
  `revalidate = 3600`. A market silent for over 24h that prints one new hour
  collapses the page's count immediately while the stale snapshot still shows
  the old one, so the two can disagree in **either** direction for up to an
  hour. Any future rule must be safe under that skew rather than assume it away.

## 4. What did ship: eight URLs that 404

Eight snapshot rows carry a raw metadata path as their id, because the identity
build has no short id for the item yet:

```
Metadata/Items/SoulCores/IdolPanther                          (Panther Idol)
Metadata/Items/SoulCores/IdolHawk                             (Hawk Idol)
Metadata/Items/SoulCores/IdolStoat                            (Stoat Idol)
Metadata/Items/Gems/SupportGemEonyrsThunder                   (Eonyr's Thunder)
Metadata/Items/Gem/SupportGemHelbrymsHide                     (Helbrym's Hide)
Metadata/Items/Currency/Expedition/ExpeditionPinnacleKey      (The Triskelion Reforged)
Metadata/Items/Currency/Expedition/ExpeditionPinnacleKeyShard (Shattered Triskelion)
Metadata/Items/Currency/Delirium/DeliriumPinnacleKey          (Raven's Reflection)
```

The sitemap emitted `${siteUrl}/poe2/currencies/${id}` unencoded, producing four-
and five-segment paths against a one-segment dynamic route. Verified against a
production build (`next build && next start`):

```
GET /poe2/currencies/Metadata/Items/SoulCores/IdolPanther        -> 404
GET /poe2/currencies/Metadata%2FItems%2FSoulCores%2FIdolPanther  -> 200
     <link rel="canonical" href=".../poe2/currencies/Metadata/Items/SoulCores/IdolPanther"/>
```

So the site was doing two wrong things at once: **advertising a 404 to a
crawl-budget-starved Googlebot**, and serving a page that resolves whose
canonical points at a URL that does not.

Both are fixed in `apps/web/lib/currency-indexability.js`:

- `currencyPagePath(id)` emits a routable path — verbatim for a routable id (620
  live canonicals are untouched), percent-encoded into one segment otherwise. It
  is used for the canonical **and** the `WebPage`/`BreadcrumbList` JSON-LD, which
  carried the same broken URL.
- `classifyCurrencyPage` marks those ids `noindex, follow` and
  `currencySitemapUrls` drops them.

**This is a workaround, not the fix.** These eight are among the *busiest*
markets on the site (18–25 samples, 109–173 priced hours in the 7-day window) —
a data-mapping bug, not thin content. Each deserves a real page.

> **Follow-up (filed):** give these eight items short ids. Investigate why
> `scripts/build-identity.mjs` / `build-catalog.mjs` produce no `shortId` for
> them — note that two sit under `Metadata/Items/Gem/` rather than
> `Gems/`, a likely path-prefix gap — and confirm the ids flow into
> `src/data/catalog-poe2.json` so `currencyName()` and `iconUrl()` resolve. The
> `unusable-slug` guard then simply stops matching, with no deploy and no code
> change.

## 5. Effect

Simulated end-to-end against the live 2026-09-03 snapshot payload through the
real `currencyIndexFromSnapshot` → `currencySitemapUrls` path:

| | before | after |
|---|---:|---:|
| Currency URLs in the sitemap | 628 | **620** |
| Total sitemap URLs | 636 | **628** |
| `noindex, follow` pages | 0 | **8** (all unroutable ids) |
| Pages hidden for lack of data | — | **0** |

## 6. Where the crawl budget actually goes

- **`/poe2/currencies` links 6 of 628 currency pages.** Outside those six cards,
  the only internal links to long-tail currency pages come from the homepage
  top-movers rail (`apps/web/components/HomeMiniRadar.jsx`, 5 rows). 614 pages
  have no crawlable path from the index page that is supposed to list them.
  Being sitemap-only is a well-known trigger for "Discovered – currently not
  indexed", and it fits the observed 280 far better than thinness does. Being
  fixed on another branch.
- **The pages are near-duplicates by template, not by emptiness.** 614 of the 620
  remaining indexable pages have no hand-written copy; they share the same "How
  to read this market" / "What the tool can tell you" boilerplate and differ only
  in name, icon and four numbers. Per-*group* editorial copy — one paragraph per
  group (essences, runes, omens, soul cores, idols) reused across its members
  alongside each member's own numbers — addresses that directly, and unlike
  `noindex` it adds reasons to crawl rather than removing them.
- **Zero external links** remains the root cause identified in Phase 0.

## Appendix — exact SQL

Scope check (default league, and the retention window actually held):

```sql
select game, realm, league, provider, count(*) rows,
       count(distinct pair_id) pairs, count(distinct completed_hour) hrs,
       min(completed_hour), max(completed_hour)
from hourly_market_candles
where game = 'poe2'
group by 1,2,3,4
order by rows desc;
-- poe2|poe2|Runes of Aldur|live rows=151349 pairs=1316 hrs=173
--   2026-08-27 04:00+00 -> 2026-09-03 08:00+00   (7-day retention, confirmed)

select game, league, is_default, realm from league_meta;   -- poe2 default = Runes of Aldur
```

Per-currency depth against the anchor, over the full retention window
(Distribution A, and the "hours since last print" figures):

```sql
with agg as (
  select case when base_currency = 'exalted' then quote_currency else base_currency end as target,
         count(distinct completed_hour)                                                   as hours_all,
         count(distinct completed_hour) filter (where completed_hour > now() - interval '24 hours') as hours_24,
         count(distinct completed_hour) filter (where completed_hour > now() - interval '72 hours') as hours_72,
         max(completed_hour)                                                              as last_hour
  from hourly_market_candles
  where game = 'poe2' and realm = 'poe2' and league = 'Runes of Aldur' and provider = 'live'
    and (base_currency = 'exalted' or quote_currency = 'exalted')
    and reference_ratio is not null and reference_ratio > 0
  group by 1
)
select target, hours_all, hours_24, hours_72, last_hour from agg order by hours_all;
-- 632 targets
```

The row set the sitemap actually reads (Distribution B, categories, names,
`layoutSource`, `samples`, `status`):

```sql
select r->>'target', r->>'targetName', r->>'category', r->>'subcategory',
       r->>'layoutSource', r->>'samples', r->>'coverage24h', r->>'stale',
       r->>'reference', r->>'status', jsonb_array_length(r->'sparkline24h')
from radar_snapshots s, jsonb_array_elements(s.payload->'rows') r
where s.game = 'poe2' and s.league = 'Runes of Aldur' and s.anchor = 'exalted';
-- 627 rows
```

Snapshot inventory (which anchor/league the SEO pages actually use):

```sql
select game, league, provider, anchor, generated_at,
       jsonb_array_length(payload->'rows') rows
from radar_snapshots where game = 'poe2';
-- Runes of Aldur | exalted | 627 rows   <- the sitemap's source
```
