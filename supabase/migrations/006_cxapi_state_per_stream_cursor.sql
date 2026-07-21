-- 006: the cxapi ingestion cursor is per (game, realm, provider), NOT per league.
--
-- One Currency Exchange CDN stream per game/realm carries EVERY league in each
-- hourly digest, so the cursor advances once per stream, independent of league.
-- The league column in cxapi_state was a mis-key: it forced a separate cursor per
-- league even though a single fetch covers them all. `hourly_market_candles`
-- already carries league in its own primary key, so candle history is unaffected.
--
-- DEPLOY ORDERING: this DROPs the league column + re-keys the primary key, which
-- is INCOMPATIBLE with the previously-deployed code (its cursor upsert targets
-- `on conflict (game, realm, league, provider)`). Apply this only together with
-- the matching application deploy, or the hourly ingest cron will error until the
-- new code is live. Prod is fixture-mode (cursor writes only), so the blast radius
-- is limited to the ingest cursor, never the candle/read path.

-- Collapse to the furthest-advanced cursor per (game, realm, provider) before the
-- key changes. Defensive: today there is at most one row per stream.
delete from public.cxapi_state c
 where c.ctid not in (
   select distinct on (game, realm, provider) ctid
     from public.cxapi_state
    order by game, realm, provider, last_digest_id desc nulls last, next_change_id desc nulls last
 );

alter table public.cxapi_state drop constraint cxapi_state_pkey;
alter table public.cxapi_state drop column league;
alter table public.cxapi_state add constraint cxapi_state_pkey primary key (game, realm, provider);
