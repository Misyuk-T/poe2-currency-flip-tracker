# BMAD story: saved markets and a bounded retention experiment

Date: 2026-09-08. Baseline: main 108e614. Status: complete; deployed and production flows verified.

## Problem → choice

The representative-price correction is delivered, but visitors have no saved
workspace or reason to check back. Deliver browser-only saved markets with honest previous-visit changes and
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
- [x] Desktop/mobile save, return, remove and scope switch; blocked-storage regressions.
- [x] Independent focused review has no blockers or majors.
- [x] Commit main, CI/deploy pass, production UI and durable counter read-back.

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


## Production acceptance — 2026-09-08

Saved UI and collector shipped as `1a6f611`; CI run 34204031880 and Vercel passed.
Production save/open/manual/reset/new-tab-return flows persisted exactly one
marker each for PoE2 (`market_saved`, `market_opened`, `manual_price_applied`,
`saved_markets_returned`) in the initially empty daily table. These four markers
are controlled QA, not user demand. Save POST was HTTP 204 with only
`{"event":"market_saved","game":"poe2"}`; SQL readback confirms all four events.

The stale saved card exposed the preceding price repair's missed DB NOT NULL
constraint. Compatibility fix `e46e5b6` passed 533 tests, production build, CI run
34204816635 and Vercel. Manual replay of the existing cron (pg_net request 921)
returned HTTP 200. Replays 922/923 completed the remaining catch-up: both games
reach 2026-09-08 07:00 UTC. Raw GGG volume-ratio verification passes. Replay
snapshot results exposed legacy JSONB-string volume compatibility in the prior
price change; scheduled snapshot repair remains an acceptance gate.


Final recovery release `afb5faf` passed CI 34205964666 and Vercel. Root independently
reran PostgreSQL 17 + postgres.js: actual repository writes yield JSONB objects;
legacy/new values qualify; malformed/zero/null strings do not; discovery returns
exactly the two valid test leagues. No production history rewrite was needed.

Existing cron replay 924 returned HTTP 200, no timeout/error, and built default
snapshots: Forbidden Rites 3 anchors / 2,011 combined rows; Allflame 5 anchors /
3,016 combined rows. Normal production API now returns the 07:00 UTC Divine
reference 132.78654518638342, `stale:false`, equal to raw GGG 5,581,948 / 42,037.
Browser card shows current 132.79 with no previous baseline; a new tab correctly
shows previous/current 132.79 at the same hour and waits for a newer hour. The
controlled save was removed and manual input reset after QA. Final tests: 534/534.
