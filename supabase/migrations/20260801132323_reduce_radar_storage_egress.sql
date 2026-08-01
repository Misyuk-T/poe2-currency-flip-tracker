-- Keep only data that has a public route in the current product. The CDN digest
-- also contains retired PoE1 leagues, and the pre-live fixture backfill is no
-- longer served after PROVIDER_MODE=live.
delete from public.hourly_market_candles
where provider = 'fixture'
   or not (
     (game = 'poe2' and league in ('Runes of Aldur', 'HC Runes of Aldur', 'Standard'))
     or
     (game = 'poe1' and league in ('Standard', 'Hardcore', 'Ruthless', 'Ancestors'))
   );

-- Seven days covers the longest current UI horizon while bounding a table that
-- otherwise grows by roughly 100k rows per day.
delete from public.hourly_market_candles
where completed_hour < now() - interval '7 days';

-- Every public radar/history route is anchored to these currencies. Other pair
-- combinations cannot appear in the UI, but accounted for most stored rows.
delete from public.hourly_market_candles
where (game = 'poe2' and not (
        base_currency in ('exalted', 'divine')
        or quote_currency in ('exalted', 'divine')
      ))
   or (game = 'poe1' and not (
        base_currency in ('chaos', 'divine', 'exalted')
        or quote_currency in ('chaos', 'divine', 'exalted')
      ));

-- Stock JSON is not read by radar, chart, history, or plan code. Future writes
-- store {}, and compacting the retained history removes the legacy payload too.
update public.hourly_market_candles
set stock = '{}'::jsonb
where stock <> '{}'::jsonb;

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

analyze public.hourly_market_candles;
