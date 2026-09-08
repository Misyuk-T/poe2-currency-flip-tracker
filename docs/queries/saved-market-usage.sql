-- Approximate browser-day markers. Each event is at most once/day/game per
-- cooperating browser. Summing days does NOT count unique people or cohorts.
-- Controlled production QA on 2026-09-08 is recorded in SAVED-MARKETS-PLAN.md.
select day, game,
  sum(count) filter (where event = 'market_opened') as market_opened,
  sum(count) filter (where event = 'market_saved') as market_saved,
  sum(count) filter (where event = 'saved_markets_returned') as saved_markets_returned,
  sum(count) filter (where event = 'manual_price_applied') as manual_price_applied
from public.daily_product_usage
where day >= (now() at time zone 'UTC')::date - 28
group by day, game
order by day desc, game;
