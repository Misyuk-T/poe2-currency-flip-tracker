import { getSql } from "../../../lib/db.js";
import { createUsageLimiter, handleUsage } from "../../../lib/usage-handler.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;
const allow = createUsageLimiter();

export function POST(request) {
  return handleUsage(request, { allow, record: async ({ game, event }) => {
    const sql = getSql();
    if (!sql) throw new Error("usage storage unavailable");
    await sql.begin(async (tx) => {
      await tx`set local statement_timeout = '2000ms'`;
      await tx`set local lock_timeout = '1000ms'`;
      await tx`
        insert into daily_product_usage (day, game, event, count)
        values ((now() at time zone 'UTC')::date, ${game}, ${event}, 1)
        on conflict (day, game, event) do update
        set count = least(daily_product_usage.count + 1, 100000)`;
      await tx`delete from daily_product_usage where day < (now() at time zone 'UTC')::date - 59`;
    });
  } });
}
