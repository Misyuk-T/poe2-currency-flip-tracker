/**
 * The default (landing) league rule.
 *
 * Named league-default, not league-meta: `apps/web/lib/league-meta.js` and
 * `/api/league-meta` are an unrelated, pre-existing reader of GGG's legacy
 * league-dates endpoint. Only the TABLE is called `league_meta`.
 *
 * The default league scopes the SEO currency pages, the currency index, the
 * sitemap and the hourly snapshot priority, so flipping it is an expensive,
 * user-visible act: it re-points 600+ indexed pages at a different economy.
 * The rule below therefore moves only when a NEW league has demonstrable depth,
 * and only ever forward in time.
 *
 * Pure: no clock of its own, no database, no config. `rows` are league_meta rows
 * (camelCase) as produced by the repository.
 */

import { isPublicLeague } from "./cx-market.js";

/**
 * Permanent leagues, as data per game rather than a regex. These never become
 * the default: they always exist, so "newest first seen" would be meaningless
 * for them, and they are not what a visitor searching for current prices wants.
 */
export const PERMANENT_LEAGUES = {
  poe1: ["Standard", "Hardcore", "Ruthless", "Hardcore Ruthless", "Solo Self-Found"],
  poe2: ["Standard", "Hardcore", "Ruthless", "Hardcore Ruthless", "Solo Self-Found"],
};

/**
 * Name affixes GGG uses for the hardcore / SSF / Ruthless variants of a
 * challenge league. The plain softcore trade league is the one the product
 * defaults to, so every variant is excluded — deliberately, not incidentally.
 *
 * Both spellings of the Ruthless variant are covered because the two games name
 * it differently: PoE 1 prefixes ("Ruthless Allflame"), PoE 2 suffixes
 * ("Runes of Aldur Ruthless"). A Ruthless economy is a fraction of the size of
 * its parent league and must never become the SEO scope.
 */
export const PERMANENT_LEAGUE_PREFIXES = ["HC ", "SSF ", "Hardcore ", "Ruthless "];
// Suffix spellings too: GGG has shipped both "HC Runes of Aldur" and
// "Forbidden Rites HC" across games and events, and either way it is a fraction
// of the parent league's economy.
export const PERMANENT_LEAGUE_SUFFIXES = [" Ruthless", " HC", " Hardcore", " SSF"];

const ALL_PERMANENT = [...new Set(Object.values(PERMANENT_LEAGUES).flat())];

/** True for permanent leagues and their hardcore/SSF variants. */
export function isPermanentLeague(league, game = null) {
  if (typeof league !== "string") return false;
  const name = league.trim();
  if (!name) return false;
  const names = PERMANENT_LEAGUES[game] ?? ALL_PERMANENT;
  if (names.includes(name)) return true;
  if (PERMANENT_LEAGUE_PREFIXES.some((prefix) => name.startsWith(prefix))) return true;
  return PERMANENT_LEAGUE_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

/** Accepts Date | ISO string | epoch ms; returns epoch ms or null. */
export function toEpochMs(value) {
  if (value == null) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Public, non-permanent leagues are the only candidates for the default. */
export function isEligibleDefaultLeague(row, game = null) {
  if (!row || typeof row.league !== "string" || !row.league) return false;
  const isPublic = row.isPublic ?? isPublicLeague(row.league);
  if (!isPublic) return false;
  const isPermanent = row.isPermanent ?? isPermanentLeague(row.league, game ?? row.game ?? null);
  return !isPermanent;
}

/**
 * Choose the default league.
 *
 *  1. Eligible = public AND not permanent.
 *  2. Deep enough = completedHours >= minCompletedHours AND pairCount >= minPairs.
 *     A day-old league fails this, which is the entire point: a new league does
 *     not take over the SEO surface on launch day.
 *  3. Hysteresis: never move to a league that was first seen EARLIER than the
 *     current default. The default only ever walks forward in league time, so a
 *     late-observed old league cannot drag it backwards.
 *  4. Nothing qualifies -> keep `currentDefault` unchanged.
 *
 * Deterministic: ties on firstSeenAt break on league name ascending.
 *
 * @param {Array<object>} rows league_meta rows
 * @param {{ game?: string|null, currentDefault?: string|null, now?: number,
 *           minCompletedHours?: number, minPairs?: number }} options
 * @returns {string|null} the league to use as the default
 */
export function chooseDefaultLeague(rows, {
  game = null,
  currentDefault = null,
  now = Date.now(),
  minCompletedHours = 48,
  minPairs = 200,
} = {}) {
  const list = Array.isArray(rows) ? rows : [];
  // A firstSeenAt in the future is bad data (clock skew, a bogus candle hour);
  // it must not be allowed to win "newest" and hijack the default.
  const withFirstSeen = list
    .map((row) => ({ row, firstSeenMs: toEpochMs(row?.firstSeenAt) }))
    .filter(({ firstSeenMs }) => firstSeenMs == null || firstSeenMs <= now);

  const currentFirstSeenMs =
    withFirstSeen.find(({ row }) => row?.league === currentDefault)?.firstSeenMs ?? null;

  const qualifying = withFirstSeen.filter(({ row, firstSeenMs }) => {
    if (!isEligibleDefaultLeague(row, game)) return false;
    if ((Number(row.completedHours) || 0) < minCompletedHours) return false;
    if ((Number(row.pairCount) || 0) < minPairs) return false;
    // Forward-only. With no known firstSeenAt for the current default there is
    // nothing to walk forward from, so every qualifying league is allowed.
    if (currentFirstSeenMs == null) return true;
    // An unknown firstSeenAt cannot be proven newer, so it loses.
    return firstSeenMs != null && firstSeenMs >= currentFirstSeenMs;
  });

  if (!qualifying.length) return currentDefault;

  const best = qualifying.reduce((winner, candidate) => {
    const a = candidate.firstSeenMs ?? -Infinity;
    const b = winner.firstSeenMs ?? -Infinity;
    if (a !== b) return a > b ? candidate : winner;
    return candidate.row.league < winner.row.league ? candidate : winner;
  });
  return best.row.league;
}
