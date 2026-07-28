-- Precomputed public radar responses.
--
-- The raw hourly candle window is intentionally retained for per-pair history,
-- but rebuilding the complete cross-market radar on a visitor request became a
-- 15-18 second query as the live table grew. The hourly ingest job now computes
-- the response once and atomically replaces this small read model. Public route
-- handlers read it by primary key.

create table if not exists public.radar_snapshots (
  game text not null,
  realm text not null,
  league text not null,
  provider text not null check (provider in ('fixture', 'live')),
  anchor text not null,
  latest_completed_hour timestamptz,
  generated_at timestamptz not null,
  refreshed_at timestamptz not null default now(),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  primary key (game, realm, league, provider, anchor)
);

alter table public.radar_snapshots enable row level security;

-- This is an internal server-side read model. Browsers use the Next.js route
-- and never query Supabase directly.
revoke all on table public.radar_snapshots from public, anon, authenticated;
