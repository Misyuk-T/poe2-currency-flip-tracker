# PoE2 Currency Flip Tracker

Market timing for Path of Exile 2 currency trading, built on the official hourly market digest.

**[Live app](https://exileradar.com)**

It answers three questions: what is moving today, what price am I actually seeing right now, and what entry and exit would recent hourly ranges support for the horizon I care about.

## What it refuses to do

These are historical estimates. Not predictions, not guaranteed arbitrage.

The distinction is enforced in the data, not just in a disclaimer. Fill probabilities return `null` because no probabilistic model exists — they are not filled with a plausible-looking number. `expectedProfit` is `null` for the same reason, and the mark-to-market figure is exposed under its own name so "what it clears at current books" can never be read as "what you can expect to make". Recommended position size is capped at a quantity that is fully executable on both legs; when the exit book cannot absorb it, the row is marked non-actionable instead of quietly shrinking.

The feed is delayed and is not an executable quote. Verify in game before trading.

## Running it

Node 20 or newer.

```bash
npm run web:dev     # http://localhost:3000
```

That is the whole setup. With no `DATABASE_URL` and `PROVIDER_MODE=fixture`, the API serves a full synthetic radar from an in-memory repository, labelled `sourceMode: fixture` so nothing pretends to be live. You get a populated UI without a database.

The fallback is deliberately narrow: automatic under `next dev`, otherwise gated behind `RADAR_FIXTURE_FALLBACK=1`. A production database outage returns an honest 503 rather than synthetic data dressed up as real.

```bash
npm test            # domain test suite (node:test)
npm run web:build
```

## Shape of the project

One Next.js app in `apps/web/`. Its `/api/*` route handlers serve the radar and history endpoints on top of shared domain logic in `src/` — catalog, gold costs, radar core and ingest, repository. There is no separate backend to start.

Production runs on Vercel with Supabase Postgres; `/api/cron/radar` handles hourly ingest.

## Further reading

[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) covers the radar computation, the gold model, storage and polling tiers, the horizon signal, and a frank list of unverified assumptions. The rest of `docs/` holds decisions, backlog, and UX notes.
