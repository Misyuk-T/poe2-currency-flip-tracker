/**
 * Go-live pre-seed: fetch the last few COMPLETED hours from the public CDN, run
 * them through the exact production pipeline (normalize + canonicalize), and emit
 * INSERT SQL for public.hourly_market_candles (provider='live') + the cxapi_state
 * cursor. Writing these BEFORE flipping the read path to live gives a zero-empty-
 * window launch. Runs read-only against GGG; the SQL is applied via the DB tool.
 *
 * Usage: node scripts/preseed-live.mjs [hours]
 * Writes: scratchpad/preseed-hour-<id>.sql (one per hour) + preseed-cursor.sql
 */
import { writeFileSync } from "node:fs";
import { normalizeCxDigest } from "../src/domain/cx-market.js";
import { metadataToCanonicalId } from "../src/server/radar-ingest.js";

const REALM = "poe2";
const LEAGUE = "Runes of Aldur";
const HOURS = Number(process.argv[2] || 6);
const OUT = process.env.PRESEED_OUT || ".";
const UA = "poe2-currency-flip-tracker/0.1 (go-live pre-seed; misyuktaras@gmail.com)";

const q = (s) => (s == null ? "null" : `'${String(s).replace(/'/g, "''")}'`);
const num = (n) => (n == null || !Number.isFinite(Number(n)) ? "null" : String(n));
const jsonb = (o) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;

async function fetchHour(id) {
  const r = await fetch(`https://web.poecdn.com/api/currency-exchange/${REALM}/${id}`, { headers: { Accept: "application/json", "User-Agent": UA } });
  if (!r.ok) throw new Error(`CDN ${r.status} for ${id}`);
  return r.json();
}

async function main() {
  const nowHour = Math.floor(Date.now() / 3600_000) * 3600;
  let id = nowHour - (HOURS + 1) * 3600; // start; end before the in-progress hour
  let lastCompleted = null, lastNext = null;
  const files = [];
  for (let i = 0; i < HOURS + 3 && files.length < HOURS; i++) {
    const payload = await fetchHour(id);
    const next = Number(payload.next_change_id);
    if (next === id) break; // terminal / in-progress — stop, don't seed it
    const { candles } = normalizeCxDigest(payload, { digestId: id, league: LEAGUE, translate: metadataToCanonicalId });
    if (candles.length) {
      const rows = candles.map((c) =>
        `('poe2','poe2',${q(LEAGUE)},'live',to_timestamp(${id}),${id},${q(c.pairId)},${q(c.base)},${q(c.quote)},` +
        `${num(c.low)},${num(c.high)},${num(c.reference)},${q(c.referenceKind)},${jsonb(c.volume)},${jsonb(c.stock)},${q(c.source)})`,
      );
      const sql =
        `insert into public.hourly_market_candles ` +
        `(game,realm,league,provider,completed_hour,digest_id,pair_id,base_currency,quote_currency,` +
        `low_ratio,high_ratio,reference_ratio,reference_kind,volume,stock,source) values\n` +
        rows.join(",\n") + `\non conflict do nothing;`;
      const path = `${OUT}/preseed-hour-${id}.sql`;
      writeFileSync(path, sql);
      files.push({ id, path, rows: rows.length });
    }
    lastCompleted = id;
    lastNext = next;
    id = next;
  }
  // Cursor: last_digest_id = newest contiguously seeded hour; next_change_id = its
  // real next. So the cron continues forward from here with no gap or re-backfill.
  const cursor =
    `insert into public.cxapi_state (game,realm,provider,next_change_id,last_digest_id,updated_at) ` +
    `values ('poe2','poe2','live',${lastNext},${lastCompleted},now()) ` +
    `on conflict (game,realm,provider) do update set next_change_id=excluded.next_change_id, ` +
    `last_digest_id=excluded.last_digest_id, updated_at=excluded.updated_at ` +
    `where excluded.last_digest_id is not null and (cxapi_state.last_digest_id is null or excluded.last_digest_id >= cxapi_state.last_digest_id);`;
  writeFileSync(`${OUT}/preseed-cursor.sql`, cursor);
  console.log(JSON.stringify({ hours: files.length, totalRows: files.reduce((s, f) => s + f.rows, 0), lastCompleted, lastNext, files: files.map((f) => `${f.id}:${f.rows}`) }, null, 0));
}
main().catch((e) => { console.error(e); process.exit(1); });
