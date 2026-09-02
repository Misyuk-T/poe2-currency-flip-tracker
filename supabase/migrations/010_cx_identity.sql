-- 010: currency identity resolved at runtime (Phase B of docs/DYNAMIC-DATA-PLAN-2026-09.md).
--
-- Live CX candles are keyed by GGG Metadata paths. `src/data/cx-identity-*.json`
-- maps those to {name, icon, category, short_id}, but it is a COMMITTED snapshot
-- rebuilt by hand (`npm run identity:build`) — so every id GGG adds mid-league
-- renders as a humanized leaf with no icon until someone merges a PR.
--
-- This table is the runtime source of truth for the same three facts. A daily
-- job (`/api/cron/identity` -> refreshCurrencyIdentity) lists Metadata ids the
-- candles carry, drops the ones the committed JSON already answers, resolves the
-- rest from RePoE + the GGG trade static catalog, and upserts them here. Readers
-- merge DB > committed JSON > humanized fallback, per field.
--
-- Deliberately identity only — name, icon, category, subcategory, short id.
-- Never a market number. A wrong icon is a cosmetic bug; a wrong price is a lie,
-- and those stay behind the existing honesty gates.
--
-- The committed JSON and the identity build scripts are NOT retired by this:
-- they remain the cold-start fallback (no database, migration not yet applied,
-- job never run) and the safety net if the upstream sources move. Do not delete
-- them.
--
-- Additive only. Apply with a trusted migration role; no browser-facing RLS
-- policies (the Next.js server is the only client, exactly like the other radar
-- tables).

create table if not exists public.cx_identity (
  game text not null,
  -- The canonical id: a full GGG Metadata path, e.g.
  -- "Metadata/Items/Currency/CurrencyAddModToRare". NOT the trade short id —
  -- that is a derived, sometimes-absent bridge and lives in short_id.
  metadata_id text not null,
  -- Every display field is nullable ON PURPOSE. A row can be written knowing
  -- only a humanized name; the retry window below picks it up again later, and
  -- the reader falls through to the committed JSON for whatever is still null.
  -- Upserts use coalesce(excluded.x, cx_identity.x) so a later, poorer answer
  -- can never blank a field the job already resolved.
  name text,
  icon text,
  category text,
  subcategory text,
  short_id text,
  -- Provenance of the row: 'repoe-catalog' (RePoE name + trade catalog icon or
  -- short id), 'repoe' (RePoE name only), 'humanized' (neither source knew it;
  -- the leaf was title-cased). Lets a future reader tell a real resolution from
  -- a placeholder without re-deriving it.
  source text not null default 'humanized',
  -- When the job last successfully resolved this row from upstream, vs when the
  -- row was last touched at all. The retry window reads updated_at.
  resolved_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (game, metadata_id)
);

-- The job's retry probe: "rows for this game that are still missing an icon and
-- have not been retried recently". A partial index keeps that off the full
-- table as the long tail accumulates.
create index if not exists cx_identity_unresolved_idx
  on public.cx_identity (game, updated_at)
  where icon is null;

alter table public.cx_identity enable row level security;

-- Internal server-side metadata. Browsers reach it only through the rendered
-- radar payload.
revoke all on table public.cx_identity from public, anon, authenticated;

-- Daily identity refresh, 04:20 UTC. Same transport, same host and the same
-- Vault-held secret as the hourly ingest (migrations 004 + 008): pg_cron ->
-- pg_net -> the Vercel route, authorized with `Bearer <CRON_SECRET>` read at run
-- time from `vault.decrypted_secrets` under the name 'radar_cron_secret'. The
-- secret is NOT stored in this file. If the vault entry does not exist yet, see
-- migration 004 for the one-time `vault.create_secret(...)` call.
--
-- timeout_milliseconds matches the route's `maxDuration = 60`, not the ingest's
-- 300s: this job makes two bounded HTTP fetches and at most 200 upserts.
--
-- ORCHESTRATOR: verify against a live `select jobname, schedule, command from
-- cron.job` before applying — 008 last moved the ingest host, and this block
-- copies that shape rather than re-deriving it.
select cron.schedule(
  'cx-identity-daily',
  '20 4 * * *',
  $$
  select net.http_post(
    url := 'https://exileradar.com/api/cron/identity',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'radar_cron_secret'), '')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
