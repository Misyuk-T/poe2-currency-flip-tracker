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
| Default league `LEAGUE` | `src/server/config.js:35-38`; scopes SEO pages/index/sitemap (`currency-summary.js:22-27,199-204`) | June-era stub, never removed | none technical; product rule: don't re-scope 600 pages onto a day-1 economy |
| Allow-list `LEAGUES`, PoE1 fallback list | `config.js:39-40`, `.env.example:58-63` | same | none |
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
- New table `league_meta(game, realm, league, first_seen_at, last_seen_at, pair_count,
  completed_hours, is_permanent, is_public, is_default, source)`; refreshed inside the
  hourly cron after snapshots (one aggregate over candles per game — bounded).
- **Default league rule:** newest public, non-permanent (not Standard/Hardcore/SSF/HC-*)
  PoE2 league with `completed_hours ≥ 48` and `pair_count ≥ 200`; otherwise keep the
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
- `exchange-layout-refresh.yml` writes to `exchange_layout` instead of opening a PR;
  `gold-costs` job writes to `gold_costs` behind `MIN_MATCHED` and a "≤5% of values
  changed by >50%" guard; failures keep the previous rows and surface in `/api/status`.
- Read paths merge DB > JSON as in Phase B.

### Phase D — official league metadata (M, blocked on T1)
- Taras replies on the GGG OAuth thread asking for `service:leagues` (+ ladder,
  `account:characters` per BACKLOG T1). When granted: T2 token plumbing, T3 fills
  `league_meta.official_name/start_at/end_at`, guide shows official dates, UI shows
  "ends in N days".

## Decisions needed from Taras
1. Default-league thresholds: 48 completed hours and ≥200 priced pairs (proposed).
2. Honesty gate: auto-apply identity/layout (proposed yes), auto-apply gold behind
   floors (proposed yes) — or keep PRs for gold.
3. Order: Phase A right after the current three branches deploy; B and C next week;
   D when GGG answers.

## Out of scope
- Per-league URLs for the 600 currency pages (a different SEO architecture; revisit
  after 1.0 when authority exists).
- Gold formula: none exists publicly; scrape stays the only source.
