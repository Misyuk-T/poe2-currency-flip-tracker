-- Retention for the hourly market radar.
--
-- Keep the function signature used by the existing daily pg_cron job. This
-- repository now owns only the hourly radar table, so a clean project must not
-- depend on the retired Phase-B market_points/snapshot_runs schema.
create or replace function public.prune_old_storage(market_point_days integer default 30, snapshot_run_days integer default 90)
returns void
language sql
security definer
set search_path to 'public'
as $function$
  delete from public.hourly_market_candles where completed_hour  < now() - make_interval(days => market_point_days);
$function$;

-- prune_old_storage is SECURITY DEFINER and destructive. It must only run from
-- the pg_cron job (role `postgres`) / trusted server role, never from the
-- public PostgREST API. Revoke EXECUTE from the API-exposed roles.
revoke execute on function public.prune_old_storage(integer, integer) from public, anon, authenticated;
