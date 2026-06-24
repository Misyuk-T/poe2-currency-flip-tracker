-- C2b: durable official hourly market digest + ingestion cursor.
-- Apply with a trusted migration role. No browser-facing RLS policies.

create table if not exists public.hourly_market_candles (
  game text not null,
  realm text not null,
  league text not null,
  provider text not null check (provider in ('fixture', 'live')),
  completed_hour timestamptz not null,
  digest_id bigint not null,
  pair_id text not null,
  base_currency text not null,
  quote_currency text not null,
  low_ratio numeric,
  high_ratio numeric,
  reference_ratio numeric,
  reference_kind text not null,
  volume jsonb not null default '{}'::jsonb,
  stock jsonb not null default '{}'::jsonb,
  source text not null,
  primary key (game, realm, league, provider, pair_id, completed_hour)
);

create index if not exists hourly_market_candles_recent_idx
  on public.hourly_market_candles (game, realm, league, provider, completed_hour desc);

-- Retention deletes filter on completed_hour alone; give them a dedicated index
-- (the recent_idx above leads with the scope columns, so it can't serve them).
create index if not exists hourly_market_candles_retention_idx
  on public.hourly_market_candles (completed_hour);

create table if not exists public.cxapi_state (
  game text not null,
  realm text not null,
  league text not null,
  provider text not null check (provider in ('fixture', 'live')),
  next_change_id bigint,
  last_digest_id bigint,
  updated_at timestamptz not null default now(),
  primary key (game, realm, league, provider)
);

alter table public.hourly_market_candles enable row level security;
alter table public.cxapi_state enable row level security;

-- Retention (30-day) is handled by extending public.prune_old_storage in
-- 003_hourly_market_radar_retention.sql, driven by the existing pg_cron job.
