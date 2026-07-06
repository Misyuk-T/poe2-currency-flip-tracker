# PoE2 Currency Flip Tracker

A backend-driven MVP for **Path of Exile 2 currency market timing**. The default
product surface uses the official completed-hour market digest plus a
user-entered current price. It answers: _what is moving today, what price am I
actually seeing now, and what conservative entry/exit would recent hourly ranges
support for my chosen horizon?_

These are **historical estimates, not guaranteed arbitrage or predictions.**
The hourly feed is delayed and not an executable quote; users should verify the
actual in-game price before trading.

## Quick start (fixture mode — offline, safe)

```bash
cp .env.example .env   # optional — sensible defaults work without it
npm run web:dev   # Next.js app (UI + API) on http://localhost:3000
```

The product is a single Next.js app under `apps/web/` (Node ≥ 20). Its own
`/api/*` route handlers serve the radar/history endpoints, reusing the shared
domain logic in `src/` (catalog, gold costs, radar core/ingest, repository) —
there is no separate backend process to run. `.env` is loaded by Next; real
environment variables always win over the file.

```bash
npm test           # run the domain test suite (node:test)
npm run web:build  # build the Next.js frontend
```

`NEXT_PUBLIC_API_BASE_URL` overrides the browser API base (defaults to
same-origin, i.e. the app's own `/api/*`), and `NEXT_PUBLIC_SITE_URL` controls
canonical URLs, sitemap and robots metadata.

**Offline data in dev:** with no `DATABASE_URL` and `PROVIDER_MODE=fixture`, the
read routes serve a full synthetic radar (the whole catalog) from an in-memory
fixture repository, so `npm run web:dev` shows data with no database — labelled
`sourceMode: fixture`. This fallback is automatic under `next dev` and otherwise
gated behind `RADAR_FIXTURE_FALLBACK=1`, so a real production database outage
still degrades to an honest 503 instead of masking it with synthetic data. A
live/persistent feed uses Postgres + the `/api/cron/radar` ingest.

## What changed vs. the original prototype

The original `app.js` made several wrong assumptions. They are fixed at the
architecture level, not patched in the browser:

| Old prototype | Now |
|---|---|
| `exchange.result` treated as an array (`.slice`) | parsed as an **object keyed by listing id** (`normalizeResult`) |
| separate `/fetch` call after exchange search | removed — offers are embedded in each listing |
| public CORS proxies (`allorigins`, `corsproxy`) | removed — frontend talks only to the local backend |
| `SAMPLE_ROWS` fallback on failure | removed from the data path — a failure renders as an **error state** |
| profit = `(sell - buy) / buy` of best listing | executable VWAP swept across book depth for a requested quantity |
| gold ignored | versioned per-item gold model affects affordability and every metric |

## Production architecture (serverless: Vercel + Supabase)

Production does **not** run the always-on Node server. It is split:

- **Frontend + API — Vercel (Next.js, `apps/web/`).** SEO pages are crawlable
  static/ISR HTML backed by real data: per-currency pages
  (`/poe2/currencies/[id]`), the currency index, and `sitemap.xml` read the
  latest completed hour and `revalidate` hourly (per-currency `lastmod`); the
  homepage hydrates a small top-movers mini-radar. Each currency page also shows
  a clearly-labelled simulated paper-trade backtest (`src/domain/paper-trade.js`,
  a deterministic flip simulation over that pair's own history — never a profit
  promise). Fixture data is labelled as such everywhere it appears, including
  JSON-LD. The Market Radar dashboard is a
  client component that calls **same-origin** Next Route Handlers under `/api/*`
  (`radar`, `radar/history`, `hotlist`, `config`, `status`). They run on the Node
  runtime and read Postgres with a bounded, per-request query — no in-memory
  snapshot, scheduler, or circuit breaker. The build is driven by the root
  `vercel.json` (`next build apps/web`).
- **Data — Supabase Postgres.** `hourly_market_candles` + `cxapi_state` (radar),
  `snapshot_runs` + `market_points` (legacy books). RLS is deny-all; only the
  server-side connection (Supavisor transaction pooler, port `6543`) touches the
  tables. Browsers never query Supabase directly.
- **Ingestion — Supabase pg_cron + pg_net.** Hourly, `pg_cron` POSTs
  `/api/cron/radar` (Bearer `CRON_SECRET`, read from Vault) which writes one
  completed hour (fixture synth, or live `cxapi` catch-up). Idempotent
  (`on conflict do nothing`) + monotonic cursor → no distributed lock needed.
  Migration `004_radar_ingest_cron.sql` schedules it.

There is no separate always-on server: the product is fully serverless on Vercel,
and local dev runs the same Next app (`npm run web:dev`). The legacy standalone
Node server, its experimental live-book opportunity engine, and the old static
`src/public/` UI have been removed; only the shared radar/domain library in
`src/` remains, reused by the Next `/api/*` route handlers.

### Environment (set in the Vercel project, never committed)

| Var | Value |
|---|---|
| `DATABASE_URL` | Supabase Transaction pooler string (`:6543`) |
| `STORAGE` | `supabase` |
| `PROVIDER_MODE` | `fixture` (until a `service:cxapi` OAuth token exists) |
| `CRON_SECRET` | long random string; also stored in Supabase Vault as `radar_cron_secret` |

`NEXT_PUBLIC_API_BASE_URL` stays unset in both production and local dev — the app
always calls its own same-origin `/api/*` route handlers.

## Architecture

The repo is a single Next.js app (`apps/web/`) plus a shared, framework-free
library in `src/` that its `/api/*` route handlers reuse. No separate process.

```
apps/web/
  app/            routes: /poe2 (dashboard), /poe2/currencies, /guides, /landing
    page.jsx      root /: temporary 307 redirect to /poe2 (landing hidden)
    api/          route handlers: radar, radar/history, status, config,
                  hotlist, opportunities, cron/radar (Bearer CRON_SECRET)
  components/     MarketDashboard, SpotChart, HomeMiniRadar, …
  lib/            radar-backend, currency-summary, market, db, http, guides
  public/icons/   neutral fallback glyph (GGG art gitignored, not committed)
src/              shared domain logic (pure, no HTTP, no DOM)
  server/         config.js, radar-core.js, radar-ingest.js
  domain/         market-radar, cx-market, hotlist, gold-costs, radar-payload,
                  catalog, paper-trade, market-price-display
  storage/        radar-repository.js (Postgres)
  providers/      ggg-cxapi-provider.js (OAuth-gated live cxapi feed)
  data/           catalog-poe2.json (749 items), gold-costs-poe2.js, fixtures/
test/             domain + Next-pipeline tests (node:test)
```

`src/domain/cx-market.js` is the **single** place that understands the GGG cxapi
response contract, so the rest of the pipeline never re-parses upstream shapes.

### HTTP API (Next route handlers, same-origin `/api`)

- `GET /api/radar?anchor=` — the completed-hour market radar payload.
- `GET /api/radar/history?pair=&anchor=` — per-pair hourly low/high range series.
- `GET /api/status`, `GET /api/config`, `GET /api/hotlist` — metadata + digests.
- `POST /api/cron/radar` — Bearer `CRON_SECRET`; ingests one completed hour
  (fixture synth or live cxapi catch-up). Idempotent + monotonic cursor.

On a data failure with no stored snapshot, reads return **HTTP 503**
(`{ error: { code: "no-database" } }`) and never fabricate rows.

### Catalog & icons (Phase C1)

The PoE2 item catalog (`src/data/catalog-poe2.json`, 749 items) holds real GGG
`trade2/data/static` **ids/names/categories** — facts, committed. The gold table
ids are reconciled against it (no guessed ids). `/api/catalog` serves a manifest
with a `supported | unknown-gold-cost` status per item.

Icon **art is © Grinding Gear Games and is NOT committed.** Run
`npm run catalog:build` to refresh the catalog and download icons into
`apps/web/public/icons/` (gitignored); the UI falls back to a neutral glyph for any
icon not downloaded. The script validates the response, restricts downloads to
GGG/CDN hosts, and guards against path traversal. Non-commercial fan use;
**commercial use requires written permission from GGG.**

Because the art is gitignored, production must run `npm run catalog:build` as a
controlled build step and include `apps/web/public/icons/` in the resulting artifact,
or copy approved assets from object storage. A plain Git checkout intentionally
contains only the fallback. Do not enable GGG art in a paid deployment without
written permission.

### Market Radar + manual current price (MVP)

The default screen is a completed-hour **Market Radar**. It consumes GGG's
OAuth-gated `service:cxapi` feed on the backend, persists its cursor, and shows
descriptive 1/3/6/12/24h movement, hourly low/high range, volume acceleration,
volatility, coverage, and transparent 0–100 activity/stability scores. The
midpoint of the published low/high range is explicitly labelled a
`range-midpoint-proxy`; it is never presented as an OHLC close or a forecast.
Fixture mode seeds clearly-labelled synthetic hourly data for local testing.

`GET /api/radar`, `GET /api/radar/history`, and `GET /api/hotlist` only read the
backend cache. Browser refreshes cannot hit GGG. In live mode the server fetches
at most once per completed hour and can perform a bounded startup catch-up using
`CXAPI_MAX_BACKFILL_HOURS`. Local storage keeps an isolated hourly JSONL file;
Supabase deployments must apply
`supabase/migrations/002_hourly_market_radar.sql` to persist both candles and the
cursor. OAuth credentials are server-only and are never returned by config or
status endpoints.

The hourly feed discovers what deserves attention; it is not an executable
quote. The detail view uses a single **Working price**:

1. user-entered current price (`You entered · now`);
2. otherwise the latest hourly midpoint (`Hourly midpoint · age`).

Recommendations are based on completed-hour history rebased onto that Working
price. For overnight-style plans (5–10h), the UI reports historical hit rate,
median time-to-hit, and adverse move from rolling hourly windows. This describes
what happened in comparable past windows; it does not pretend to forecast a
future sale.

### Experimental live books / backlog

The older trade-site/current-book opportunity engine still exists for research
and tests, but it is **not part of the default MVP UI**. Set
`ENABLE_LIVE_BOOKS=true` to expose the separate “Live books” view and the
capital/gold/ranking controls. This path remains experimental/backlog for a
future paid workflow where users may verify actual current prices.

### Tiered live polling

Live mode uses a bounded scheduler instead of polling the whole catalog:

- `SHORTLIST` is the hot tier and runs on the normal poll interval (5 minutes);
- warm and cold slices rotate independently (defaults: 4 targets every 15/60
  minutes);
- the initial default universe is the allowlisted Currency, Fragments and
  Essences categories; gems, waystones and other catalog groups are not silently
  treated as five-minute currency markets;
- every opportunity exposes `marketFreshness` with tier, fetch time, age and
  overdue state; `/api/status` exposes tier sizes, cursors and tracked counts.

The official `service:cxapi` feed requires an approved OAuth application. Until
credentials exist, live mode reports `waiting-oauth` honestly; fixture mode uses
synthetic data. Current execution quotes still come from the isolated
experimental exchange provider.

The in-memory book cache is capped by `MAX_TRACKED_TARGETS` (default 250), with
the hot shortlist and anchor pairs protected from eviction. Rebuilding the
catalog or icons while the server is running requires a server restart before
the manifest changes.

### Storage (Phase B)

History/snapshot persistence sits behind a `StorageProvider` seam (like the
market provider):

- **`local`** (default, zero-dep): in-memory ring buffers + per-anchor JSONL
  under `.data/`. Used for offline dev and the whole test suite.
- **`supabase`** (`STORAGE=supabase` + `DATABASE_URL` + `npm install postgres`):
  durable Postgres — `snapshot_runs` (cycle metadata) and `market_points`
  (history time series), keyed by `game,realm,league,anchor,provider,target`,
  with RLS (no public policies) and a daily `pg_cron` retention job
  (30d points / 90d runs). `provider` = fixture|live, so the two never mix.

Reads always come from the in-memory buffer (no per-request DB hit). Durable
writes are **best-effort**: the buffer updates first and every DB op is
time-bounded, so a Supabase outage can neither fail a refresh nor degrade
serving. The connection string is server-side only — never exposed to the
browser. Only `book_levels`/`quotes` were intentionally NOT persisted (they
depend on request-time constraints / add write volume without serving value).

### History & charts (isolated per source/market)

Each successful tier poll appends a lightweight, **constraint-independent**
market point only for targets actually refreshed in that cycle. Local mode
persists JSONL under `.data/`; optional Supabase mode writes the same points to
Postgres. Both reload into an in-memory serving buffer.

History is **strictly isolated**: the file name is derived from a scope of
`mode + game + realm + league + anchor`, so fixture and live data can never
share a file (`history-fixture__…` vs `history-live__…`) and switching
league/anchor/mode starts a clean file. Every persisted point carries provenance
(`mode`, plus `synthetic:true` for all fixture points); on load, points whose
provenance doesn't match the store are dropped, which makes legacy unscoped
files safe to ignore and guarantees synthetic data can never contaminate a live
analysis.

In **fixture mode** a synthetic backfill (flagged `synthetic:true`, labelled
"synthetic history" in the chart) seeds ~6h of points so charts have shape, and
prices gently oscillate. **Live mode** starts empty and fills in real time —
nothing synthetic.

### Horizon signal (transparent, not a forecast)

The horizon selector (1/3/6h) is **honest**, not decorative. For each target the
engine derives descriptive statistics over the matching lookback window from the
**real, provider-matched** history points: mean spread, **spread momentum**
(least-squares slope, pp/hour), **spread volatility** (stdev), and the observed
range. These re-weight the resource-adjusted ranking score
(`riskAdjustedScore`) via a small, documented, bounded multiplier — so changing
the horizon materially changes the ranking and the displayed signal. The signal
is `status:"insufficient-history"` with **null** metrics (never synthesized)
whenever **either** fewer than 3 real points fall in the window **or** those
points span too little of the horizon. The signal reports `spanHours` and
`coverageFraction`, and requires a minimum coverage (`DEFAULT_MIN_COVERAGE`,
default **0.5**, overridable per call) before it is trusted — three readings ten
minutes apart do **not** describe a 6-hour horizon just because they fall inside
the 6h window. This is explicitly **not** a probability or ML forecast;
`fillProbability` stays `null` by design.

**Actionability requires a valid, fresh signal.** A row is only marked
`actionable:true` when it is rankable, has a positive current-book spread, a
**valid** history signal (`status:"ok"`, i.e. enough samples *and* coverage),
and a **non-stale** quote. A fresh install with insufficient real history is
never turned into a Buy recommendation from a single current spread — its
calculator metrics stay visible in the non-actionable details, but the summary
explicitly says it is *not* a buy recommendation. Stale data is likewise never
actionable. Fixture mode seeds a full **6h** of clearly-`synthetic` history so
the demo exercises the actionable path honestly across every horizon.

## The gold model (why direction matters)

Gold cost is charged per **received** unit, per leg:

```
gold_for_leg = ceil(received_quantity * goldPerUnit)
```

For a round trip A → B → A:

```
total_gold = ceil(received_B  * goldCost[B])   // entry
           + ceil(received_A  * goldCost[A])   // exit
```

Worked example (also a test): spend 1000 Exalted to receive 5 Divine, later
sell those Divine for 1050 Exalted:

```
entry gold = 5    * 800 =   4,000
exit  gold = 1050 * 120 = 126,000
total      =            = 130,000 gold
profit     = 50 Exalted
efficiency = 2,600 gold per Exalted of profit
```

A visible 5% return is unusable for a player with only 40,000 gold — which is
exactly why the UI surfaces **gold per cycle**, **profit per 100k gold**, and a
**limiting resource** (gold / capital / liquidity / position).

The table lives in `src/data/gold-costs-poe2.js` as a maintainable
`[itemId, displayName, goldPerUnit]` table with shared provenance
(`game, patchOrVersion, effectiveFrom, source`) and is a **versioned snapshot**,
not a permanent formula. PoE1 and PoE2 tables can never be merged
(`createGoldRegistry` throws on a mixed-game list).

**Coverage is validated, gaps are never guessed.** At startup
(`validateShortlistCoverage`) the server checks that the anchor and every
shortlist target has a verified gold cost; missing ids are logged loudly and
exposed at `GET /api/config → shortlistCoverage`. A target without a cost is
marked **`rankable:false`** (unrankable), excluded from the ranked/actionable
list, and shown separately in the UI — its gold cost is never invented. The
default shortlist intentionally includes `vaal`, which has **no** brief-verified
cost, to exercise this honest "unrankable" path; add a sourced row to the gold
table to make it rankable.

## Live data (official cxapi feed)

The live radar feed comes from GGG's official OAuth-gated `service:cxapi`
currency-exchange API, isolated in `src/providers/ggg-cxapi-provider.js` and
driven by the env-gated `POST /api/cron/radar` ingest route. It returns hourly
digests and omits the incomplete current hour — good for history and candidate
generation, **not** for five-minute execution quotes.

> The earlier **experimental** path that called the website-internal, undocumented
> `trade2/exchange` endpoint (`ggg-exchange-provider.js`, run via the standalone
> Node server) has been **removed**. A narrow live canary (Exalted ↔ Chaos)
> verified that shape once on 2026-06-20; it was never approved for production.

**Commercial production must seek written permission from GGG.** This is a
product constraint, not an implementation detail to hide. References:

- https://www.pathofexile.com/developer/docs
- https://www.pathofexile.com/developer/docs/reference#currencyexchange
- https://www.pathofexile.com/legal/terms-of-use-and-privacy-policy

## Current limitations / unverified assumptions

- The GGG response contract is an **observation from 2026-06-19**, not a
  guaranteed API. Currency ids in the gold table and shortlist are assumed to
  match GGG `have`/`want` ids; this needs confirmation against live data.
- Fill **probabilities (1h/3h/6h) are `null` by design** — there is no
  probabilistic model yet, and they are not fabricated. The horizon signal is a
  transparent descriptive statistic, not a probability.
- **`expectedProfit` is `null` by design** — a true expected value needs a
  probability/forecast model that does not exist yet, so the field is never
  aliased to the gross. The current-book / mark-to-market estimate is exposed
  separately and explicitly as **`currentBookGrossProfit`** (equal to
  `grossProfit`), so "what it clears at the current books" is never mistaken for
  "what you can expect to make".
- **Sizing only recommends a fully-executable round-trip quantity**: the
  recommended quantity must be exactly fillable on entry *and* fully sellable on
  the exit book given observed bundle sizes/depth. If bundle sizes are
  incompatible the engine drops to the largest common executable size, or
  classifies the row non-actionable (`bundle-mismatch` / `exit-not-executable`)
  rather than over-promising a quantity the exit book can't absorb.
- Both legs are quoted from a single snapshot; real execution risk (price drift
  while holding inventory, cancellations) is acknowledged in the UI but not
  modelled.
- Hot targets remain explicitly configured by `SHORTLIST`; warm/cold candidates
  are category-allowlisted and rotated. Activity ordering from official cxapi is
  not active until GGG grants `service:cxapi` credentials. Durable Postgres is
  optional; the latest opportunity snapshot remains in memory.
- Trend charts show **market** price/spread history, not user-specific profit.
  History is a single best-price-per-snapshot series, not full book replay.
- Per-account depth independence is tracked (unique-account counts) but not yet
  used to discount depth.

## Configuration

Copy `.env.example` to `.env`. Covers port, provider mode, game/realm/league,
anchor currency, shortlist, tier categories/intervals/batch sizes, poll interval
(default 5 min), max listing age, user-agent/contact, and optional server-side `POESESSID`. No
seasonal league is hardcoded as the only option.
