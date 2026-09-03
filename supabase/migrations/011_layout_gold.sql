-- 011: exchange layout + gold costs resolved at runtime (Phase C of
-- docs/DYNAMIC-DATA-PLAN-2026-09.md).
--
-- Two committed snapshots are still hand-refreshed today:
--
--   src/data/exchange-layout-poe{1,2}.json  — the in-game Currency Exchange
--     sidebar: which category and section an item sits in and in what order.
--     Rebuilt by `npm run layout:build` from poedb.tw / poe2db.tw and merged by
--     a daily PR (.github/workflows/exchange-layout-refresh.yml). Between merges
--     every item GGG adds renders as "Needs classification".
--
--   src/data/gold-costs-poe2.js — gold per received unit for 651 items, scraped
--     from poe2db.tw and matched to the trade catalog by exact display name.
--     Its refresh workflow was never pushed to GitHub, so this file has had NO
--     automation at all since 2026-07-25.
--
-- These two tables are the runtime source of truth for the same facts. A daily
-- job (`/api/cron/data-refresh` -> refreshExchangeLayout + refreshGoldCosts)
-- reparses both upstream pages with the SAME pure parsers the build scripts use
-- and upserts here. Readers merge DB > committed snapshot, per item, per field.
--
-- The honesty gate differs between the two on purpose (design principle 3 in
-- the plan, decided by Taras 2026-09-02):
--
--   layout — ordering and grouping. A wrong section is a cosmetic bug, so it
--     auto-applies behind a coverage floor (>= 80% of the committed item and
--     section counts).
--
--   gold — a NUMBER users act on. It auto-applies only behind the existing
--     MIN_MATCHED = 500 coverage floor AND a volatility guard (a batch is
--     refused when more than 5% of the items whose value changed moved by more
--     than 50%). A refused batch keeps the previous rows; it never guesses, and
--     it never interpolates a value for an item it could not match.
--
-- Neither table ever deletes: a run that parses fewer items leaves the older
-- rows standing rather than blanking a fact the readers are using. Failures are
-- traced and surface in /api/status as `layout` / `gold` row counts + fetchedAt.
--
-- The committed files and their build scripts are NOT retired by this. They stay
-- as the cold-start fallback (no database, migration not yet applied, job never
-- run) and as the safety net if poedb/poe2db move. Do not delete them.
--
-- Additive only. Apply with a trusted migration role; no browser-facing RLS
-- policies (the Next.js server is the only client, exactly like the other radar
-- tables).

-- ---------------------------------------------------------------------------
-- exchange_layout
-- ---------------------------------------------------------------------------
-- Shaped by what src/domain/exchange-layout.js actually consumes, not by what
-- the scrape happens to produce. `resolveExchangeLayout` looks an item up by
-- Metadata id first, then by normalized display name, then falls back to
-- matching a SECTION name against the row's trade category — and all it reads
-- off the match is {category, section, categoryOrder, sectionOrder, itemOrder}.
-- The category/section list the sidebar renders (`exchangeLayoutCategories`) is
-- DERIVED from these rows by grouping on (category, category_order) and
-- (section, section_order); that derivation reproduces the committed
-- `categories` array byte-for-byte for both games (asserted in
-- test/exchange-layout-parse.test.js), which is why there is no second table.
create table if not exists public.exchange_layout (
  game text not null,
  -- Stable per-item key: the GGG Metadata path when the page exposes one
  -- (data-hover), else the normalized display name. Metadata ids are unique
  -- within a game's snapshot and can never collide with a normalized name (one
  -- contains "/" and capitals, the other is lowercase alphanumerics + spaces).
  -- A plain normalized-name key would NOT do: PoE1 ships two distinct "Delirium
  -- Orb" rows in one section (generic vs hardmode) that differ only by Metadata
  -- id, and collapsing them would silently drop one.
  item_key text not null,
  -- Nullable: 77 of the 669 PoE2 rows carry no data-hover at all. The reader
  -- indexes by whichever of these it has.
  metadata_id text,
  name text,
  normalized_name text,
  -- The poedb article slug. Kept because the build script's
  -- `preserveKnownMetadataIds` uses (href, normalized name) as the identity that
  -- lets a known Metadata id survive an opaque data-hover; a row without it
  -- cannot participate in that recovery.
  href text,
  -- The four facts the radar rows are actually sorted and grouped by.
  category text,
  category_order integer,
  section text,
  section_order integer,
  item_order integer,
  -- Provenance: the upstream URL the row was parsed from.
  source text,
  -- When the parse that produced this row was fetched, vs when the row was last
  -- touched at all. /api/status reports max(fetched_at) as the layout's age.
  fetched_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (game, item_key)
);

-- The reader's only query: every row for one game, ordered. A game has ~700-1100
-- rows, so this index is what keeps the whole read an index-ordered scan of one
-- game's prefix rather than a sort over both games.
create index if not exists exchange_layout_game_order_idx
  on public.exchange_layout (game, category_order, section_order, item_order);

alter table public.exchange_layout enable row level security;

-- Internal server-side metadata. Browsers reach it only through the rendered
-- radar payload.
revoke all on table public.exchange_layout from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- gold_costs
-- ---------------------------------------------------------------------------
-- Shaped by what createGoldRegistry consumes (src/domain/gold-costs.js): a flat
-- list of {game, itemId, displayName, goldPerUnit, effectiveFrom, source} that
-- it folds into an itemId -> record map, keeping the most recent effectiveFrom.
-- `item_key` is the TRADE SHORT ID ("exalted", "divine"), because that is the id
-- the catalog manifest and every radar row are keyed by — not a Metadata path.
-- An item the scrape cannot match to a short id is simply absent: the honesty
-- rule is that a missing gold cost is reported as a coverage gap and the target
-- is marked unrankable, never guessed.
create table if not exists public.gold_costs (
  game text not null,
  item_key text not null,
  -- Carried for provenance and for the /api/status eyeball test; the registry
  -- keys on item_key and takes its label from the catalog.
  display_name text,
  -- Gold spent per unit RECEIVED. Integer upstream, stored wide enough that a
  -- fractional fee ("1/1000" on PoE1's Rogue's Marker) does not have to be
  -- rounded into a lie.
  gold_per_unit numeric,
  source text,
  fetched_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (game, item_key)
);

alter table public.gold_costs enable row level security;

revoke all on table public.gold_costs from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Daily refresh transport
-- ---------------------------------------------------------------------------
-- 04:40 UTC — after the identity job at 04:20 (migration 010) so the two never
-- contend for the same instance, and well clear of the hourly ingest's :00.
--
-- Same transport, same host and the same Vault-held secret as the hourly ingest
-- (migrations 004 + 008) and the identity refresh (010): pg_cron -> pg_net ->
-- the Vercel route, authorized with `Bearer <CRON_SECRET>` read at run time from
-- `vault.decrypted_secrets` under the name 'radar_cron_secret'. The secret is
-- NOT stored in this file. If the vault entry does not exist yet, see migration
-- 004 for the one-time `vault.create_secret(...)` call.
--
-- timeout_milliseconds matches the route's `maxDuration = 60`, exactly as 010
-- does: this job makes at most three bounded HTML fetches and writes ~1800 rows
-- in batches of 50.
--
-- ORCHESTRATOR: verify against a live `select jobname, schedule, command from
-- cron.job` before applying — 008 last moved the ingest host, and this block
-- copies 010's shape rather than re-deriving it.
select cron.schedule(
  'data-refresh-daily',
  '40 4 * * *',
  $$
  select net.http_post(
    url := 'https://exileradar.com/api/cron/data-refresh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'radar_cron_secret'), '')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
