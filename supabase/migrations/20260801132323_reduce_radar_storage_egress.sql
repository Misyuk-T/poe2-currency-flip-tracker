-- This index duplicates the primary key's exact columns; Postgres can scan the
-- primary key backwards for completed_hour DESC. Dropping it is deliberately
-- the migration's first and only storage mutation: it commits quickly and frees
-- roughly 250 MB before any operational cleanup runs in small batches.
drop index if exists public.hourly_market_candles_pair_recent_idx;

create or replace function public.prune_old_storage(market_point_days integer default 30, snapshot_run_days integer default 90)
returns void
language sql
security definer
set search_path to 'public'
as $function$
  delete from public.market_points         where observed_at    < now() - make_interval(days => market_point_days);
  delete from public.snapshot_runs         where started_at     < now() - make_interval(days => snapshot_run_days);
  delete from public.hourly_market_candles where completed_hour  < now() - interval '7 days';
$function$;

revoke execute on function public.prune_old_storage(integer, integer) from public, anon, authenticated;
