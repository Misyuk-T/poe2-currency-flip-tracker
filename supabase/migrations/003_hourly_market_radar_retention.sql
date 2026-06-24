-- Retention for the hourly market radar.
--
-- The Phase-B storage migration already created public.prune_old_storage(...)
-- and a daily pg_cron job (`prune-old-storage`) that calls it. We extend the
-- SAME function (identical signature) so the existing cron job keeps calling it
-- unchanged and now also prunes hourly_market_candles at the same 30-day horizon
-- as market_points.
create or replace function public.prune_old_storage(market_point_days integer default 30, snapshot_run_days integer default 90)
returns void
language sql
security definer
set search_path to 'public'
as $function$
  delete from public.market_points         where observed_at    < now() - make_interval(days => market_point_days);
  delete from public.snapshot_runs         where started_at     < now() - make_interval(days => snapshot_run_days);
  delete from public.hourly_market_candles where completed_hour  < now() - make_interval(days => market_point_days);
$function$;

-- prune_old_storage is SECURITY DEFINER and destructive. It must only run from
-- the pg_cron job (role `postgres`) / trusted server role, never from the
-- public PostgREST API. Revoke EXECUTE from the API-exposed roles.
revoke execute on function public.prune_old_storage(integer, integer) from public, anon, authenticated;
