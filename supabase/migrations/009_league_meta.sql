-- 009: observed league metadata + the persisted default (landing) league.
--
-- A league exists, for this product, when its first candle lands. Everything the
-- default-league rule needs is therefore measurable from
-- `hourly_market_candles`: when we first and last saw it priced, how many
-- distinct pairs it carries, and how many completed hours we hold. The hourly
-- cron refreshes this table with ONE bounded aggregate per (game, realm,
-- provider) and then persists its choice in `is_default`.
--
-- Why persist the choice instead of recomputing it on every read: the rule is
-- hysteretic (forward-only, depth-gated) so it needs the previous decision as an
-- input, and the read routes must not pay an aggregate to learn which league the
-- SEO pages are scoped to.
--
-- Additive only. Apply with a trusted migration role; no browser-facing RLS
-- policies (the Next.js server is the only client, exactly like the other radar
-- tables).

create table if not exists public.league_meta (
  game text not null,
  realm text not null,
  provider text not null check (provider in ('fixture', 'live')),
  league text not null,
  -- Earliest / latest completed hour ever observed for this scope. first_seen_at
  -- is written with least(existing, new) by the refresh job so seven-day
  -- retention pruning can never make an old league look newly born (which would
  -- corrupt the forward-only hysteresis in the default-league rule).
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  -- Depth of the CURRENT retention window, not an all-time total: distinct
  -- priced pairs and distinct completed hours seen in the refresh window.
  pair_count integer not null default 0,
  completed_hours integer not null default 0,
  -- Classification, computed by the application from the league name
  -- (isPublicLeague / isPermanentLeague) and stored so the rule and any future
  -- reader agree on one answer.
  is_public boolean not null default true,
  is_permanent boolean not null default false,
  -- Exactly one row per (game, realm, provider) should carry this. Enforced by
  -- the writer (setDefaultLeague clears the others in the same transaction)
  -- rather than by a constraint, so a partial-unique index is not needed for
  -- correctness — only for the lookup below.
  is_default boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (game, realm, provider, league)
);

-- The read path asks exactly one question: "which league is default for this
-- stream?". A partial index keeps that a single-row lookup regardless of how
-- many leagues accumulate.
create index if not exists league_meta_default_idx
  on public.league_meta (game, realm, provider)
  where is_default;

alter table public.league_meta enable row level security;

-- Internal server-side metadata. Browsers reach it only through /api/config.
revoke all on table public.league_meta from public, anon, authenticated;
