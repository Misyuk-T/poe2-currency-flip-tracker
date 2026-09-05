# Dynamic data plan — September 2026

Goal (Taras, 2026-09-02): "динаміка на все — на валюти і на ліги". No env lists,
no hand-edited league facts, no git snapshots that go stale between monthly PRs.
Grounded in a code inventory (Sonnet, 2026-09-02, file:line in the table) and
the league-launch trace in `LEAGUE-LAUNCH-RUNBOOK.md`.

## What is already dynamic (don't rebuild)

- Ingest takes every public league in the CX digest (`src/server/radar-ingest.js:288-289`).
- League discovery from candles: `listPricedLeagues()` (`src/storage/radar-repository.js:222-240`),
  unioned into `/api/config` (`apps/web/lib/radar-backend.js:607-641`); `?league=` works for
  any priced league (`resolveLeagueAccess`, since c0d6c70).
- Hourly snapshots for every priced league (branch `feat/snapshots-all-leagues`).
- Unknown CX Metadata ids still get a candle, a dashboard row, a currency page and a
  sitemap entry — with a humanized name and no icon (`src/domain/cx-identity.js:78-90`).
- Icon 404s resolved at render time (`apps/web/lib/icon-candidates.js`).

## What is static, and why it was

| Piece | Where | Why it exists | Blocker |
| --- | --- | --- | --- |
| Default league `LEAGUE` | **shipped 2026-09-02** (`6985783`) — `resolveDefaultLeague` (`apps/web/lib/default-league.js`) resolves it per-request from `league_meta.is_default`; `LEAGUE`/`POE1_LEAGUE` is now an emergency pin, not the source | was a June-era stub | none — done |
| Allow-list `LEAGUES`, PoE1 fallback list | `config.js:39-40`, `.env.example:58-63` | PoE1's hardcoded fallback list is gone (discovery + `POE1_LEAGUES` override); `LEAGUES` still widens the live selector | none |
| PoE2 league metadata (name before first candle, start/end) | `league-meta` works for PoE1 only (`apps/web/app/api/league-meta/route.js:15-18`) | GGG legacy endpoint ignores `realm=poe2` | `service:leagues` OAuth = T1, external |
| Guide `currentLeague` | `apps/web/lib/league-start-guide.js` (branch) | content const | facts need a source |
| `cx-identity-*.json` (Metadata → name/icon/category) | `scripts/build-identity.mjs`, RePoE + GGG static | monthly PR (`data-refresh.yml`) — honesty rule | none technical |
| `catalog-poe2.json` | GGG `trade2/data/static` | monthly PR | none technical |
| `gold-costs-poe2.js` | poe2db scrape, exact-name match, `MIN_MATCHED=500` | GGG publishes no formula | source is an HTML scrape |
| `exchange-layout-*.json` | poe2db/poedb scrape | daily PR | HTML scrape |

## Design principles

1. **Our own data is a first-class source.** A league exists when its first candle
   lands; its "start" is the first priced hour we observed; its depth is measurable.
   That is honest ("first seen on the exchange"), needs no GGG grant, and is what the
   product actually cares about.
2. **DB is the runtime source of truth; git JSON is the fallback.** Jobs write to
   tables, readers merge `DB > committed snapshot`. Removing the snapshots comes later,
   once the jobs have run for a few weeks.
3. **Honesty gate stays where it protects users, goes where it only creates staleness.**
   Identity data (name/icon/category/section order) auto-applies with sanity floors —
   a wrong icon is not a market claim. Anything shown as a number to users (gold
   cost) auto-applies only behind the existing coverage floor plus an alert; a failed
   floor keeps the previous value, never guesses.
4. **Hysteresis on anything that re-scopes SEO.** The default league flips only when
   the new league has real depth; env `LEAGUE` becomes an override, not the source.

## Phases

### Phase A — leagues from data (S/M, first)
**STATUS (2026-09-02):** part 1 shipped in `6985783` (merge of
`feat/league-meta`; migration 009 applied to production ~19:30Z) — the
`league_meta` table, the hourly refresh, `chooseDefaultLeague`,
`resolveDefaultLeague` and the `/api/config`/`/api/status` fields below are
all live. Two follow-ups came out of review and were accepted as-is rather
than fixed, because both are only reachable when the resolved default has
zero priced pairs: the last-resort "best priced league" fallback
(`bestPricedLeague` in `apps/web/lib/default-league.js`) is not filtered by
public/permanent, and it calls `chooseDefaultLeague` with `minPairs: 1`,
which could in principle pick a day-one league. Part 2 (sourcing the guide's
`currentLeague` facts from `league_meta`) is in progress.
- New table `league_meta(game, realm, league, first_seen_at, last_seen_at, pair_count,
  completed_hours, is_permanent, is_public, is_default, source)`; refreshed inside the
  hourly cron after snapshots (one aggregate over candles per game — bounded).
- **Default league rule:** newest public, non-permanent (not Standard/Hardcore/SSF/HC-*)
  PoE2 league with `completed_hours ≥ 8` and `pair_count ≥ 200`; otherwise keep the
  current default. Persisted as `is_default`; `LEAGUE` env, when set, overrides. All
  readers (`loadConfig().league` consumers: currency pages, index, sitemap, snapshot
  priority, `/api/status`) read the DB default via one helper with a short in-memory TTL.
- PoE1: same discovery replaces the hardcoded fallback list; `league-meta` keeps
  enriching PoE1 with official dates.
- `/api/config` exposes `leagues[].firstSeenAt/lastSeenAt/depth` so the UI can label
  "new league · day 2" without GGG metadata.
- Guide: `currentLeague.name/startsAt` come from `league_meta` (first seen); the prose
  paragraph about mechanics stays per-league content with its official source link.
- Tests: rule with fixtures (fresh league below threshold → no flip; above → flip;
  permanent leagues never default; env override wins).

### Phase B — currency identity from data (M)
**STATUS (2026-09-02):** shipped in `75741ae` (merge of `feat/cx-identity-db`;
migration 010 applied ~19:58Z, pg_cron job `cx-identity-daily` 04:20 UTC live).
Two review rounds: observed ids are reverse-mapped to Metadata paths before
resolution; only official/learned taxonomy sources are stored as `category`;
`subcategory` stays null; upserts batched by 50; `/api/status.identity =
{ overrides, iconlessRows }`. **What it does NOT do:** no new SEO pages —
currency URLs are short ids canonicalised at ingest from committed JSON.
Follow-ups: (B2, review-gated) ingest-time canonicalisation from `cx_identity`
(re-keys `pair_id`, mints URLs — needs a backfill plan); defensive dedupe in
`upsertCxIdentity`; unify the PoE1 build script's inline trade-static parse.
Also: the "monthly PR safety net" `.github/workflows/data-refresh.yml` exists
only locally (untracked 2026-07-25, push token lacked `workflow` scope) — Taras
to add it via GitHub UI or accept that Phase B/C replace it.
- Job (daily-guarded step in the cron, or a separate `/api/cron/identity` on pg_cron)
  lists Metadata ids observed in candles that have no identity, fetches RePoE
  `base_items` + GGG `trade2/data/static`, resolves, writes `cx_identity(game, metadata_id,
  name, icon, category, subcategory, short_id, source, resolved_at)`.
- Read-time merge in `resolveCurrency()`: DB row > committed JSON > humanized fallback.
- Sanity: never overwrite a resolved row with a worse one (null icon over a real icon);
  floor on batch size; trace + alert on unresolved count.
- Then `data-refresh.yml` shrinks to a safety net; the committed JSON stays as cold-start
  fallback.

### Phase C — layouts and gold to DB (S/M)
**STATUS (2026-09-03):** implemented on `feat/layout-gold-db`; migration 011 is
written but **NOT applied**. Shape:
- Migration `011_layout_gold.sql` — `exchange_layout(game, item_key, …)` keyed
  by "Metadata id, else normalized name" (PoE1 ships two `Delirium Orb` rows that
  differ only by Metadata id), and `gold_costs(game, item_key, gold_per_unit, …)`
  keyed by trade short id. RLS + revokes as in 010; one
  `cron.schedule('data-refresh-daily', '40 4 * * *')` posting to
  `/api/cron/data-refresh` with the same vault secret and a 60s timeout.
  The sidebar category tree is **derived** from the item rows (verified to
  reproduce the committed `categories` byte-for-byte for both games), so there is
  no third table.
- Both parses were factored out of `scripts/` into
  `src/domain/exchange-layout-parse.js` and `src/domain/gold-costs-parse.js`; the
  build scripts and the job now share ONE implementation, round-trip-tested
  against the committed files field-for-field (1795 layout items, 651 gold rows).
- Guards: 10s fetch + one retry; layout ≥80% of the committed item AND section
  counts; gold keeps `MIN_MATCHED=500` + required anchor ids, plus the volatility
  rule, over the items present in both baseline and batch **whose value changed**:
  fewer than 20 changed → allow (the ratio is noise at that size); otherwise
  refuse if >5% moved by >50%; and refuse regardless if >50 items moved by >50%.
  The baseline is the stored rows, falling back to the committed table on the
  first run, so even the first DB write is guarded. A refused batch keeps the
  previous rows.
  - The 20-item sample floor is not a softening — it is what stops the guard
    freezing gold permanently. Without it ONE legitimately-changed item that
    doubles is 1/1 = 100% → refuse, and because a refused batch never advances
    the baseline, every later run refuses identically and gold stays on the
    committed July table forever with only a cron trace as the signal. A league
    patch retuning a few fees is exactly that shape. The absolute cap covers the
    opposite hole (a rescale hidden inside thousands of other changes).
- Read paths merge DB > JSON per item/field via `apps/web/lib/layout-overrides.js`
  and `gold-overrides.js` (2s, `attempts: 1`, `onTimeout: resetSql`,
  single-flight, 10-minute TTL, 42P01 → traced empty). They are loaded **only by
  the hourly cron** (`refreshRadarSnapshots`), not on the `/api/radar` rebuild
  path: `db.js` is `max: 1` and each loader's repo carries `onTimeout: resetSql`,
  which destroys the client the rebuild already captured — `CONNECTION_DESTROYED`
  is retryable, so `withDbRetry` would retry on the dead object and return 502.
  The stored rows reach users through the snapshots the cron bakes them into, so
  the fast path still reads nothing and the request path takes no new risk. Thread
  them back into `getRadar` once the `db.js`/`withDbRetry` hazard is fixed.
- `/api/status` gains `layout: { rows, fetchedAt }` and `gold: { rows, fetchedAt }`
  from those same cached reads.
- `.github/workflows/exchange-layout-refresh.yml` stays as the labelled fallback.
- Known limitation: the round-trip tests re-render the committed files from the
  parsers' own regexes, so they prove the parse is stable but not that our model
  of the live pages is right. The run-time coverage floors are what catch a page
  that changed shape.

- `exchange-layout-refresh.yml` writes to `exchange_layout` instead of opening a PR;
  `gold-costs` job writes to `gold_costs` behind `MIN_MATCHED` and a "≤5% of values
  changed by >50%" guard; failures keep the previous rows and surface in `/api/status`.
- Read paths merge DB > JSON as in Phase B.

### Phase D — official league metadata (M, blocked on T1)
- Taras replies on the GGG OAuth thread asking for `service:leagues` (+ ladder,
  `account:characters` per BACKLOG T1). When granted: T2 token plumbing, T3 fills
  `league_meta.official_name/start_at/end_at`, guide shows official dates, UI shows
  "ends in N days".

## Decisions (Taras, 2026-09-02: "все так, го")
1. Default-league thresholds: 8 completed hours and ≥200 priced pairs — **decided**
   (lowered from 48 on 2026-09-05, see DECISIONS).
2. Honesty gate: identity/layout auto-apply; gold auto-applies behind floors — **decided**.
3. Order: Phase A first (shipped), then B and C, D when GGG answers — **decided**.

## Out of scope
- Per-league URLs for the 600 currency pages (a different SEO architecture; revisit
  after 1.0 when authority exists).
- Gold formula: none exists publicly; scrape stays the only source.
