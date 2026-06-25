# Next stage plan — PoE2 Currency Flip Tracker

Agreed roadmap. We execute sequentially, with independent Claude review,
parallel where they don't conflict. Rules across all phases:

- **Commit and push** each completed step (keep `main` up to date).
- Never fabricate data (catalog, gold costs, freshness, prices, probabilities).
- Every step ships with tests; README updated at the end of each phase.
- Storage: **Supabase** (project `exalted-flip`) behind a `StorageProvider`
  interface. Prod/commercial questions (auth, GGG art licensing) deferred.

## API budget (why Phase C must be tiered)

The committed catalog has **749 items**. With four-item entry batches, polling
all of them against two anchors would cost about **1,874 requests/cycle**. Even
the default market-category universe (Currency + Fragments + Essences) is too
large for five-minute full refreshes. Phase C therefore uses bounded rotating
tiers and provider rate-limit headers, never rate-limit evasion.

---

## Phase A — offline core (fixtures, no live API)

- **A1. Anchor + gold modes.** Selector Exalted/Divine; gold modes
  `strict` / `show-only` / `ignore` (default `strict`). Backend keeps a cached
  book per anchor. When gold is ignored, ranking switches to
  ROI / profit / capital-efficiency instead of profit-per-100k.
- **A2. Ranking modes.** expected profit / ROI / profit-100k / profit-hour /
  lowest-risk / highest-liquidity. Risk inputs labelled `heuristic`, never
  `probability`.
- **A3. Polling hardening.** Remove public `?refresh=1`; Refresh only re-reads
  the snapshot. Add stale-while-revalidate, degraded mode, circuit breaker,
  per-IP rate limit, input/size validation, request timeout, backoff on
  429/5xx. Force-refresh only via protected admin/CLI.
- **A4. De-slop design.** Remove `border-left`/decorative gradients/excess
  pills; even borders all round; restrained PoE atmosphere; dense desktop,
  readable mobile cards.
- **A5. Observability.** `/api/status` + structured logs: last successful poll,
  cycle duration, items updated, stale/failed books, request count, rate-limit
  buckets, 429/5xx, scheduler lag, cache age, active game/league/anchor combos.
  No secrets.
- **A6. UX.** localStorage for all settings; filters (category, search,
  actionable-only, hide-unknown-gold, freshness); permalink query params;
  clear empty/blocked states; local timestamps.
- **A7. Game + league selector.** Backend returns available + blocked options;
  PoE1 shown as `Coming later` (disabled). No seasonal league hardcoded in FE.

## Phase B — data layer on Supabase

- **B1. `StorageProvider` interface + Supabase adapter** (`exalted-flip`).
  Tables: raw snapshots, normalized levels, executable quotes (multiple position
  sizes), history signals, provider errors, rate-limit state. Isolation key
  `game + realm + league + anchor + target + provider`. Retention + compaction +
  schema migrations. Secrets server-side only (`.env`). Local fallback
  (JSONL/in-memory) kept for offline dev/tests.

## Phase C — needs network / live access

- **C1. Catalog + icons.** GGG `data/static` → manifest
  `itemId → displayName → category → goldCost → localIcon → status`
  (`supported | unrankable | unknown-gold-cost`). Download icons locally
  (no hotlink) + fallback + attribution. Show icons in table/cards/modal/selectors.
- **C2. Tiered scheduler.** target hot set ~6–8 × 2 anchors / 5 min (current
  safe default: 3); warm currency
  round-robin ~20–30 min; cold categories ~30–60 min; candidate generation from
  official `cxapi` hourly digest. Per-item freshness surfaced in UI.
- **C3. Paper-trade journal.** recommendation → entry price → fill after
  1/3/6h → max adverse move → simulated profit → gold efficiency. No "model
  finds profitable flips" claim without this.

## Phase D — auth + hosting (serverless, "Variant B")

Goal: **no always-on Node host in production.** Compute moves to Vercel; Supabase
stays the durable data layer (DB/Auth/Storage). Decided with a codex architecture
review (2026-06-24). The always-on Node server (`src/server/index.js`) is kept
only for local fixture/live-book dev.

Decisions:
- **Compute substrate: Vercel Cron + Next.js Route Handlers (Node runtime).** All
  domain code is reused unchanged from `src/` (single ESM package). Supabase Edge
  Functions (Deno) were rejected for the MVP to avoid a runtime port.
- **Server-side opportunities (executable book / VWAP) is DEFERRED.** The full
  order-book ladder is never persisted (only summary `market_points`), and the
  source is an undocumented, non-approved endpoint. The radar surface (official
  hourly digest, fully Postgres-backed) ships serverless first. Opportunities stay
  available only in local self-host dev (`ENABLE_LIVE_BOOKS`).
- **Reads stay server-side; RLS stays deny-all.** The browser never queries
  Supabase directly — Next Route Handlers read Postgres via the server-only
  connection. No anon read policies.
- **Scheduling:** one `CRON_SECRET`-protected `/api/cron/radar` route on Vercel
  Cron (hourly, just after the hour). Cursor catch-up + single-flight use a
  Postgres **advisory lock** + transactional cursor update, never process memory.
- **Drop in-process state:** the circuit breaker and per-IP rate limiter were
  process-bound; a scheduled function just fails and retries next tick. Rate limit
  (if needed) moves to the CDN/edge layer.
- **Auth is still deferred** (per the original brief). Supabase Auth (Discord +
  Google OAuth) is the chosen mechanism; its trigger is **C3** (the paper-trade
  journal is the first per-user data — that is when per-user RLS policies land).
  Billing (~USD 5) would be Stripe + a webhook writing subscription status to
  Postgres, gated by RLS — not a Supabase feature.

Implementation phases (each ships with tests + a codex review):
- D1. Serverless radar core: pure payload builder extracted from `app.js` +
  per-request Postgres repository (no startup hydration).
- D2. Next.js read routes (`/api/{config,radar,radar/history,hotlist,status}`);
  frontend points at same-origin `/api` instead of the `/backend` proxy.
- D3. `/api/cron/radar` ingestion (advisory lock + transactional cursor +
  `ingestion_runs` observability); `vercel.json` schedule.
- D4. Retire the always-on Node server from production; README + deploy docs.
- D5. (Later, gated) revisit serverless opportunities once the GGG endpoint is
  approved: persist latest ladders, recompute reads from them.

**Status:** D1–D4 shipped and live in production (Vercel + Supabase). The radar
read path and the hourly pg_cron→/api/cron/radar ingestion are verified end-to-end
(fixture data). Remaining: D5 (gated on the cxapi OAuth approval) and the
follow-ups noted below.

---

## Status

- [x] A1 (gold modes + anchor selector Exalted/Divine: per-anchor cached books,
      per-anchor isolated history, star-shaped catalog targets)
- [x] A2 (ranking modes + risk heuristic)
- [x] A3 (polling hardening: public ?refresh=1 removed, reads are cache-only/SWR,
      circuit breaker + exp backoff, per-IP rate limit, jittered scheduler,
      query-size limit, request timeouts, token-protected admin /admin/refresh)
- [x] A4 (de-slop design)
- [x] A5 (/api/status observability endpoint + structured per-cycle JSON refresh logs)
- [x] A6 (localStorage, search, min-profit, actionable-only, hide-unknown-gold,
      hide-stale, permalink/copy-link, empty/blocked states. Category filter
      deferred to C1 — needs the catalog's category metadata.)
- [x] A7 (game/league selectors fed by backend /api/config; PoE1 disabled
      "Coming later"; non-active leagues advertised but disabled; no league
      hardcoded in the frontend.)
- [x] B1 (StorageProvider seam + local JSONL impl + Supabase/postgres.js impl;
      DB schema snapshot_runs + market_points applied to `exalted-flip`, RLS on,
      pg_cron daily retention; reads from in-memory buffer, DB best-effort with
      timeouts; codex-reviewed. NOTE: live Supabase path needs DATABASE_URL +
      `npm install postgres` — not yet exercised against a real connection.)
- [x] C1 (catalog: 749 real GGG trade ids/names/categories committed as metadata;
      gold-table ids reconciled to real trade ids; /api/catalog with
      supported|unknown-gold-cost status; scripts/build-catalog.mjs downloads
      icons locally — validated, path-/host-/size-guarded; committed fallback
      glyph + gitignored art; icons in table/cards/modal; codex-reviewed.)
- [x] C2a (bounded hot/warm/cold rotation, category candidate universe,
      incremental atomic book merge, request-budget estimator, per-item
      freshness in API/UI, scheduler observability, 250-target cache cap)
- [ ] C2b (official cxapi activity ordering; requires an approved OAuth app with
      `service:cxapi`. Catalog order is the explicit fallback until then.)
- [ ] C3 (paper-trade journal)

### A1 note
Gold modes (strict/show/ignore) are done end-to-end. The **anchor selector
(Exalted/Divine)** is deferred to its own step because it needs per-anchor
cached books + anchor-scoped history (entangled with Phase B), not just a UI
toggle.
