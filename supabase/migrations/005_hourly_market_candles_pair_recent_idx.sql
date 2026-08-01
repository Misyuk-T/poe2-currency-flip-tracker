-- Performance: the radar read (readCandleWindow) needs the newest N completed
-- hours PER PAIR. The prior plan used a window function that read every in-window
-- row for every pair and sorted them — 44-60s once the fixture catalog filled the
-- 30-day retention (~500k rows), well over the 8s serverless statement_timeout, so
-- /api/radar returned 502 whenever the CDN cache expired.
--
-- This index matches the per-pair "latest first" access pattern exactly
-- (scope columns + pair_id + completed_hour DESC), letting the rewritten
-- LATERAL query fetch each pair's newest N rows via a bounded index range scan.
-- Query drops to ~1.3s. The existing recent_idx (…, completed_hour DESC) leads
-- with scope but not pair_id, so it can't serve the per-pair ordering.
--
-- The original live index was created CONCURRENTLY out of band. The checked-in
-- migration uses a regular CREATE so a clean project can apply the full history
-- transactionally; at this point the table is empty.
create index if not exists hourly_market_candles_pair_recent_idx
  on public.hourly_market_candles (game, realm, league, provider, pair_id, completed_hour desc);
