-- D3: hourly radar ingestion trigger. Supabase pg_cron calls the Vercel route
-- /api/cron/radar over HTTPS via pg_net, authenticated with CRON_SECRET.
--
-- The secret is NOT stored in this migration or in the cron.job command. It is
-- read at run time from Supabase Vault. Before this works, run ONCE (with your
-- real secret — the same value set as CRON_SECRET in the Vercel project env):
--
--   select vault.create_secret('<CRON_SECRET>', 'radar_cron_secret');
--
-- (To rotate later: select vault.update_secret(id, '<NEW>') ... )

create extension if not exists pg_net;

-- Hourly, five minutes past the hour, so the upstream completed hour has settled.
select cron.schedule(
  'radar-ingest-hourly',
  '5 * * * *',
  $$
  select net.http_post(
    url := 'https://poe2-currency-flip-tracker.vercel.app/api/cron/radar',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'radar_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
