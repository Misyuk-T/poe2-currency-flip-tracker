-- Point the hourly ingest at the canonical domain. The old
-- poe2-currency-flip-tracker.vercel.app host now 301s to exileradar.com for
-- everything outside /api/*, and pg_net does not follow redirects — so the
-- scheduler must stop depending on the legacy host. /api/* is deliberately
-- excluded from that redirect so ingestion keeps running until this is applied.
select cron.alter_job(
  job_id := (select jobid from cron.job where jobname = 'radar-ingest-hourly'),
  command := $$
  select net.http_post(
    url := 'https://exileradar.com/api/cron/radar',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'radar_cron_secret'), '')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $$
);
