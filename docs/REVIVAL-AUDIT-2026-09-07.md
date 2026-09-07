# Revival audit — 2026-09-07

Scope: read-only production/data research and a proposed bounded experiment.
No application code, upstream polling schedule, repository permissions, or
production settings were changed. Existing staged outbound drafts are unrelated.

## Recommendation

Prioritize trustworthy reference prices, then one reason to return (saved markets
and a view of changes since the last visit). Do not fund another general SEO or
feature sprint before checking whether users find the core numbers useful.
These are product hypotheses, not a measured explanation of traffic loss.

## P0: range centres are unsuitable as an unqualified market exchange rate

Live `/api/radar?game=poe2` reported Forbidden Rites and
`units.divineInExalted = 11.40175425099138`. Its Divine row had low=1,
high=130 and `referenceKind=range-center-geometric`.

The original GGG CDN payload confirms these endpoints: this is not an ID,
league, or reciprocal-direction mismatch. Three consecutive completed hours:

| UTC hour, September 7 | GGG extrema, Exalted/Divine | Current geometric centre | Exalted volume / Divine volume |
| --- | --- | --- | --- |
| 17:00 | 1–129 | 11.358 | 5,385,825 / 44,547 = 120.902 |
| 18:00 | 1–140 | 11.832 | 5,103,186 / 40,669 = 125.481 |
| 19:00 | 1–130 | 11.402 | 4,631,244 / 36,913 = 125.464 |

During this inspection, poe.ninja's public Currency overview for the exact same
league returned `core.primary=divine`, `core.rates.exalted=118`. Its observation
window is not proven identical, so 118 is a comparison, not ground truth or a
current executable quote. The aggregate-volume ratio is a candidate statistic;
this audit does not establish its suitability as VWAP or an execution price.

Code evidence: `src/domain/cx-market.js` deliberately uses `sqrt(low * high)`
in `rangeCenter()` and recomputes it on reads in `candleForAnchor()`. The comment
already acknowledges low-outlier sensitivity. Geometric symmetry fixes quote
orientation, but does not establish a representative trading price. The
reference feeds dashboard prices, conversions and history-derived metrics.

### Bounded correction gate

1. Validate the meaning of both `volume_traded` fields against the documented
   contract and observed samples across multiple pairs, hours and orientations.
2. Compare candidate volume-ratio estimates with public economy estimates,
   accounting for league, units, item identity and observation age. Do not use a
   competitor as an unquestioned oracle or silently blend sources.
3. Keep the hourly low/high as range context. If a representative price cannot
   be justified, publish uncertainty rather than passing the centre as a rate.
4. Verify all consumers together: headline price, anchor conversion, chart,
   percentage movement, trade guidance, currency pages and structured metadata.
   Historical recomputation/snapshot compatibility must be explicit.
5. Tests should exercise the observed Divine outlier, inverse orientation,
   absent/zero volumes, stale observations and a normal narrow range. A change
   to this accepted price invariant needs focused independent review.

Definition of done: the observed 1–130 case cannot silently become an ordinary
11.4 exchange rate; each published statistic has a supported meaning and source.
Do not turn historical extrema or third-party estimates into executable spreads.

## Market data: useful alternatives to internal trade-site scraping

**Existing GGG public CDN:** already ingested hourly. The official Currency
Exchange contract describes completed-hour aggregates, not current order books.
Polling faster cannot create live bid/ask prices.

**poe.ninja public economy API:** current documentation explicitly allows the
documented economy overview surface, including PoE2 exchange and item pricing.
Live league and Currency-overview probes returned 200. Possible uses are a
reference-price comparison or a genuinely different tool, not a duplicate site.
PoE2 refresh is roughly hourly, so this is not a speed advantage. Use backend
caching, conditional requests, source labels and an identifiable User-Agent;
obey actual response cache headers and stop/back off on rejection. No integration
or recurring requests were enabled during this audit.

**PoE2Scout:** a published Swagger endpoint was found, but this audit did not
validate its payload freshness, quotas or suitability for live order books.
Treat it as an investigation candidate, not a promised data unlock.

**Internal GGG trade endpoints:** current developer policy explicitly excludes
undocumented internal endpoints and prohibits reverse engineering them. A low
request rate alone does not resolve that restriction. The repo previously
removed its experimental `trade2/exchange` provider. Do not rebuild the product
around this dependency; the documented feeds above deserve evaluation first.

## P1: one retention experiment after the price correction

Existing functionality includes hourly charts, movement/range metrics, a trade
plan and manual in-game price input. A new generic calculator would duplicate
existing work. No saved-market UI or custom analytics events were found in the
app source; Vercel Analytics itself is mounted in the root layout.

Proposed first slice: save a handful of markets per game/league in the browser
and show changes since the previous visit, using the validated price statistic.
Show source time, missing/stale data, and never imply an order has filled.
Keep the initial slice account-free. Closed-browser Telegram/email/push alerts
would require a separate subscription/delivery design and should wait for demand.

Add minimal events to distinguish visits from use: market opened, market saved,
return to saved markets, and existing manual-price application. Do not log the
entered price or a player's inventory. Verify analytics delivery; a source
import alone does not prove production event collection.

## P2: distribution and a stopping rule

After P0 and the small P1 slice, publish one useful before/after market example
with a direct market link and source time. Prepared forum/Reddit drafts exist.
No external messages were posted in this audit. The earlier Reddit post with a
next-day link is an inconclusive acquisition test, not proof of no demand.

Suggested experiment: 3–4 weeks within the paid domain period. Seek 20–30
relevant users and at least five who return/use the saved markets, with direct
feedback from several users. These are proposed decision thresholds, not
industry benchmarks or a statistically conclusive test. If qualified visits are
absent, acquisition remains untested; if visits arrive but use/returns do not,
avoid expanding the feature set without a specific explanation from users.

Fresh Search Console performance and URL Inspection remain necessary to
diagnose search visibility. Missing public search results do not prove removal
from Google's index. Do not add mass generated landing pages or paid links as a
substitute for validating the product.

## Failed GitHub email: independent maintenance issue

Runs 34112675697 (Sep 7), 34025172696 (Sep 6) and 33957538930 (Sep 5) all failed
at `Open a PR if the layout changed` with:

> GitHub Actions is not permitted to create or approve pull requests.

Sep 7 regenerated 687 PoE2 layout items and passed 511 tests before this step.
The workflow already grants `contents: write` and `pull-requests: write`; the
repository setting blocks PR creation. Minimal fix: enable the repository
setting allowing Actions to create/approve PRs, then rerun the failed job.
This audit did not change that permission. No parser/retry patch is indicated.

The workflow is a committed-snapshot safety net, not the production updater.
Live `/api/status` returned official/live data, Forbidden Rites, 1,325 pairs,
layout 687 and gold 656, both metadata timestamps 2026-09-07T04:40:01.331Z.
Latest completed market hour was 19:00Z. The site and radar API returned 200.

## Evidence sources

- Production: https://exileradar.com/api/status and https://exileradar.com/api/radar?game=poe2
- GGG inspected hour: https://web.poecdn.com/api/currency-exchange/poe2/1788807600
- GGG contract: https://www.pathofexile.com/developer/docs/reference#currencyexchange
- GGG policy and rate limits: https://www.pathofexile.com/developer/docs
- poe.ninja usage and endpoints: https://poe.ninja/docs/api
- Inspected comparison: https://poe.ninja/poe2/api/economy/exchange/current/overview?league=Forbidden%20Rites&type=Currency
- Scout discovery only: https://api.poe2scout.com/swagger/index.html
- Failed job: https://github.com/Misyuk-T/poe2-currency-flip-tracker/actions/runs/34112675697
