# BMAD story: saved markets and a bounded retention experiment

Date: 2026-09-08. Baseline: main 108e614. Status: implementation accepted; production delivery verification pending.

## Problem → choice

Prices are now reliable, but visitors have no saved workspace or reason to check
back. Deliver browser-only saved markets with honest previous-visit changes and
an observable usage experiment. Existing Vercel team is Hobby; custom events
require Pro. Keep Vercel pageviews and add small first-party daily counters in
existing Postgres, not a paid analytics subscription.

## Change and invariants

- Saved items isolated by game and league; exact target/anchor identity.
- A visit is one tab session. Freeze the previous comparison in sessionStorage; reloads and background updates
  must not silently replace what 'previous visit' means.
- Compare only positive, finite, fresh hourly volume references in the same
  units, with a newer source hour. Missing/stale data never imply zero or gains.
- Local storage only, bounded to 30 markets per scope; malformed/blocked storage
  gets a clear recoverable state. No server-side saved lists or login.
- Reuse existing radar/history requests and plan dialog; no new market polling.
- Daily usage counters only: event, game, UTC day and count; exactly four allowlisted events.
  No identity, market list, entered price, inventory, IP or user agent stored.
  Anonymous daily return occurrences are directional evidence, not unique people.
- Strict event allowlist, request size/origin checks and bounded local rate limit;
  failures never block saves or plans. DB table RLS deny-all for browser roles.
- No Search Console mutation, external post, permissions or paid service changes.

## Validation gates

- [x] Independent Sol plan accepted.
- [x] Storage/visit/anchor/stale/scope race regression tests.
- [x] Collector validation and database privilege/aggregate tests.
- [x] Full tests and production build.
- [x] Desktop/mobile save, return, remove, scope switch and blocked storage QA.
- [x] Independent focused review has no blockers or majors.
- [ ] Commit main, CI/deploy pass, production UI and durable counter read-back.

## Next

Observe 3–4 weeks within the paid domain period. Proposed, non-statistical
threshold: 20–30 relevant visitors and direct evidence of at least 5 people
returning. Counters cannot prove distinct people across days/devices; supplement
with direct feedback. Do not interpret a lack of qualified visits as product
rejection. Distribution remains a separate user-authorized step.

## Accepted measurement semantics

The four events are `market_opened`, `market_saved`, `saved_markets_returned`,
`manual_price_applied`. The client marks each at most once per UTC day/game in
localStorage before best-effort POST; it does not retry. A return requires saved
entries at the start of a tab session and a compatible loaded radar response.
No raw identifying properties leave the browser. DNT/GPC opt-outs are respected.
Collection has bounded per-instance rate limits, not distributed bot proofing.
Controlled QA requests will be documented so they are not mistaken for demand.

Sources: [Vercel custom-event plan restriction](https://vercel.com/docs/analytics/custom-events),
[Supabase table security](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Operator readout

Run the checked-in [28-day aggregate query](queries/saved-market-usage.sql)
through the linked Supabase CLI or controlled SQL editor. Compare daily markers
with Vercel qualified page visits and direct user feedback. Do not divide these
counts to claim conversion or retention cohorts: browsers can clear storage,
block analytics, return on several days, use multiple devices, or spoof events.
There is deliberately no public endpoint exposing the aggregates.

Validation so far: baseline 518 tests; collector tests 5/5; actual PostgreSQL 17
20 concurrent increments yielded exactly 20, RLS enabled and anon/authenticated
privileges denied. Final full-suite/browser/release evidence follows.

Production additive table applied through linked Supabase CLI on 2026-09-08,
after independent collector/migration acceptance. Read-back: RLS enabled,
`anon` SELECT false, `authenticated` INSERT false. Security advisors show no new
warnings (the pre-existing `extension_in_public` warning is unchanged). Collection
prunes to exactly 60 inclusive UTC date buckets.

Local browser evidence: save Divine → reload retains current-visit baseline;
a separate tab has prior/current 224.09 for the same completed hour and correctly
waits for a newer hour. PoE1 shows no PoE2 saves; switching back restores Divine.
Opening the saved plan, applying manual 125 and resetting works; saved comparisons
continue to use the observed reference. 375px screenshot shows wrapped timestamps
and status, document width 364px, no console errors. Fixture QA sends no usage.

Final acceptance: 532/532 tests, production build and diff check pass. Independent
Sol review accepted after fixing the cross-scope save race and write-side storage
size limits. Scope transitions hide old state immediately; save validates source
scope again at the storage boundary. Both local/session oversized writes preserve
existing data. Browser remove → re-save → reload correctly clears the previous
baseline. Blocked/corrupt storage and precise freshness boundaries are covered by
regressions; browser checks use normal storage.

Residual limitations: localStorage updates are not atomic across simultaneously
writing tabs; a rare concurrent save can be lost. Clearing browser storage loses
saved lists. Client clock affects freshness checks. No paid service or account
feature was added. These limits are accepted for the small local experiment.
