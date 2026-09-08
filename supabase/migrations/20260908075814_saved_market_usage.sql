-- Aggregate usage markers only; no raw events or visitor identifiers.
-- Browser roles have no access. Next.js writes through its existing server DB role.
create table public.daily_product_usage (
  day date not null,
  game text not null check (game in ('poe1', 'poe2')),
  event text not null check (event in (
    'market_opened', 'market_saved', 'saved_markets_returned', 'manual_price_applied'
  )),
  count bigint not null default 0 check (count between 0 and 100000),
  primary key (day, game, event)
);
alter table public.daily_product_usage enable row level security;
revoke all on table public.daily_product_usage from public, anon, authenticated;
comment on table public.daily_product_usage is
  'Approximate browser-day usage markers, not unique people or cohort retention. No identifiers. Pruned after 60 days on collection.';
