# BMAD story: representative hourly currency prices

Status: complete; implementation delivered and production verified.
Date: 2026-09-07. Scope: the first revival slice, price reliability only.

## Problem and user outcome

A user comparing Divine against Exalted sees about 11.4 because the app treats
the geometric centre of the hourly 1–130 extrema as an exchange rate. The same
GGG hour reports 4,631,244 Exalted and 36,913 Divine traded: their ratio is
125.463766. A range centre is mathematically reciprocal but not representative
of where trading took place. It also feeds conversions, movement and guidance.

The corrected app must give a clearly identified historical estimate supported
by the traded volumes, retain the actual hourly range, and show unavailable when
the estimate cannot be supported. It must not claim a live quote or an order fill.

## Analysis evidence

Read-only CDN checks covered PoE2 hours 1788807600 and 1788804000 and PoE1 hour
1788807600, all leagues. Of 6,397 records with positive finite volumes and valid
ratio bounds, all volume ratios lay within those bounds; 189 differed from the
geometric centre by at least 2x. Another 2,470 records lacked positive usable
volumes and/or ratio bounds. These counts describe samples, not total coverage.

Divine / Exalted in Forbidden Rites:

| UTC hour | Range | Geometric centre | Traded-volume ratio |
| --- | --- | --- | --- |
| 2026-09-07 17:00 | 1–129 | 11.3578 | 120.9021 |
| 2026-09-07 18:00 | 1–140 | 11.8322 | 125.4810 |
| 2026-09-07 19:00 | 1–130 | 11.4018 | 125.4638 |

GGG documents per-currency `volume_traded` in completed-hour aggregate trade
history. Label our derived statistic literally as the hourly traded-volume
ratio/reference, not as a median, close, executable quote or guaranteed profit.
The independent poe.ninja comparison (118 in the same league) supports checking
our model but is not an oracle: its time window and estimator differ.

Sources:
- https://www.pathofexile.com/developer/docs/reference#currencyexchange
- https://web.poecdn.com/api/currency-exchange/poe2/1788807600
- https://poe.ninja/docs/api

## Accepted scope and invariants

- One common reference calculation from the two positive finite traded amounts.
- Preserve quote orientation, original extrema, league boundaries, timestamps,
  manual-price precedence and the distinction between historical and live data.
- No geometric-centre fallback when the reference is unavailable.
- Recompute old stored candles on read using their existing volume fields;
  invalidate derived radar caches by payload version. No database migration.
- Ensure a newer unusable hour does not promote an older estimate to a current
  price. Preserve explicit unavailable/stale state through API and UI.
- Update dashboard, chart, currency page/metadata and guide wording together.
- No new upstream integration, extra production polling, SEO expansion, alerts,
  authentication, account permissions or unrelated workflow fix in this story.

## Acceptance and verification

- [x] Baseline: 511/511 tests pass on unchanged main 4b34082.
- [x] Reproduce with original public GGG payloads, including both game realms.
- [x] Independent Sol plan review completed. Reference is quote volume / base
  volume, validated against positive finite amounts and the oriented range with
  a small floating-point tolerance. Preserve the exact quotient; never clamp.
  Missing latest reference retains the newest range/hour and nulls current
  metrics. Snapshot version becomes 7. Missing-price pages remain discoverable.
- [x] Regression covers the observed 1–130 / 125.463766 example and inverse.
- [x] Missing/zero/nonfinite/inconsistent volumes cannot fabricate a rate.
- [x] Latest invalid hour, history, conversions and manual override verified.
- [x] Old radar snapshots are rejected; newly built payloads agree with pages.
- [x] Full tests and production build pass.
- [x] Independent focused diff review has no unresolved blocking findings.
- [x] Browser verification covers core rates, detail/history and manual entry.
- [x] Task-only change is committed to main and deployed; live API and page
  checks confirm new semantics. Preserve the user's staged outbound work.

## Delivery and rollback

Work in `codex/representative-market-prices` from main 4b34082, integrate only
after acceptance. Deliver through the existing GitHub → Vercel integration.
Rollback must explicitly invalidate the new derived snapshots as well as
reverting the estimator; never trust structural freshness across semantics.
Record exact commit and deployment evidence when the story is complete.

## Accepted implementation evidence

- 518/518 tests; production build and diff check pass.
- Public replay: 6,386 usable normalized references, zero quotient/inverse
  mismatches across the three captured digests.
- Live Forbidden Rites canary: 28 hours, 50,584 candles, 593 independent raw
  ratio comparisons; reciprocal product 1.00000; all checks pass.
- Actual PostgreSQL 17: nine malformed/zero/null/array/fraction/positive JSONB
  volume cases, zero eligibility mismatches. SQL only probes positive volumes;
  domain code is the single authority for quotient/range validity.
- Browser: core cards, Divine plan, history, manual 125 override and reset;
  375px history renders with document width 364px and no console errors.
- Independent Sol review found SQL evaluation-order and missing-state canary
  issues; both fixed and re-reviewed. Final acceptance has no blockers/majors.

## Production delivery

Implementation commit: `e657807add36beaf434de7c3f2cbee8a91626b24` on `main`.
[GitHub CI](https://github.com/Misyuk-T/poe2-currency-flip-tracker/actions/runs/34162532042)
and [Vercel deployment](https://vercel.com/misyuktaras-2055s-projects/poe2-currency-flip-tracker/64VEFiod8ktQ9zJ8Reo1y7bEFJu8)
succeeded. Verified 2026-09-07 around 21:20 UTC:

- Production radar is payload v7, Forbidden Rites, Divine hourly reference
  `129.11696890003364` at completed hour `1788811200000` (20:00 UTC).
- Independent same-hour GGG volumes: `4,222,254 / 32,701`, exact agreement.
  Previous production reference for that same hour was `48.218253804964775`.
- History endpoint returns 70 candles with the repaired latest ratio/kind.
- Radar, history, Divine currency page, config, status and sitemap return 200;
  the currency page contains the new hourly traded-volume explanation.
- Production browser shows Divine `129`, 24h `+24.44%`, no console errors.
- Original staged and unstaged Reddit drafts were preserved byte-for-byte.

This completes only the price-reliability story. Retention/SEO experiments and
GitHub Actions PR-creation permissions remain outside this release.
