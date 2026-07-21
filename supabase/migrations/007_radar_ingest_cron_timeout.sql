-- Keep the scheduler transport alive for the same five-minute budget as the
-- Vercel Function (`maxDuration = 300`). The previous 60-second pg_net timeout
-- could abort a healthy multi-stream ingest before Vercel reached its limit.
select cron.alter_job(
  job_id := (select jobid from cron.job where jobname = 'radar-ingest-hourly'),
  command := $$
  select net.http_post(
    url := 'https://poe2-currency-flip-tracker.vercel.app/api/cron/radar',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'radar_cron_secret'), '')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $$
);
