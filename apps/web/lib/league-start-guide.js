// League facts for the evergreen /guides/league-start-currency page.
//
// Two sources, never mixed:
//   1. `announcedLeague` — what GGG announced, every field traceable to an
//      official post. It is the ONLY place league mechanics prose lives, because
//      mechanics are something we can only ever quote, never observe.
//   2. `league_meta` — what our own hourly exchange data has actually SEEN. A
//      first priced hour is an observation, so it is phrased as "seen on the
//      exchange", never as "launched".
//
// `resolveGuideLeague()` merges the two and says which of the three cases the
// page is in, so a new league stops needing a hand edit to be named at all.
//
// House rule: nothing here may assert a price, a ratio or a market outcome.
// Sources for the announced league:
//   announcement  — https://www.pathofexile.com/forum/view-thread/3999858
//   press release — https://www.pathofexile.com/forum/view-thread/3999865
//   event FAQ     — https://www.pathofexile.com/forum/view-thread/4000430
import { isPublicLeague } from "../../../src/domain/cx-market.js";
import { isPermanentLeague, toEpochMs } from "../../../src/domain/league-default.js";

export const announcedLeague = {
  name: "Forbidden Rites",
  version: "0.5.5",
  // FAQ: "Forbidden Rites begins at 1PM PDT on September 4th, which is
  // Sep 04, 2026 11:00 PM (GMT+3) in your local time." 23:00 GMT+3 = 20:00 UTC.
  startsOn: "4 September 2026",
  startsAt: "1 PM PDT",
  startsAtUtc: "20:00 UTC",
  startsAtIso: "2026-09-04T20:00:00Z",
  // FAQ: "Forbidden Rites will run until the 1.0 full release and will end
  // alongside Runes of Aldur." The announcement dates 1.0 to December 11.
  endsWith: "the 1.0 full release",
  // The previous league keeps running in parallel rather than being replaced.
  parallelLeague: "Runes of Aldur",
  // The only mechanics prose on the page, quoted from the press release. It is
  // never shown for a league we merely observed: we have no source for those.
  mechanics:
    "0.5.5 puts Ritual sites in every campaign area, returns the Wildwood as an endgame mechanic — entered from an Endgame Map using a Sacred Bloom acquired through Ritual — and overhauls the Trial of Chaos.",
  source: "https://www.pathofexile.com/forum/view-thread/3999858",
  pressSource: "https://www.pathofexile.com/forum/view-thread/3999865",
  faqSource: "https://www.pathofexile.com/forum/view-thread/4000430",
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "4 September 2026, 21:00 UTC" — stable regardless of the server's locale. */
export function formatUtcInstant(value) {
  const ms = toEpochMs(value);
  if (ms == null) return null;
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm} UTC`;
}

/**
 * "1 market", "137 markets". A day-one league has exactly one of things often
 * enough that "1 markets across 1 completed hours" would ship on launch day.
 */
export function plural(count, singular, many = `${singular}s`) {
  return `${count} ${Math.abs(count) === 1 ? singular : many}`;
}

const sameLeagueName = (a, b) =>
  typeof a === "string" && typeof b === "string" && a.trim().toLowerCase() === b.trim().toLowerCase();

// refreshLeagueMeta aggregates candles over a 7-day window, so a league_meta row
// written from a COLD table has its first_seen_at clamped to that window's floor
// rather than to the league's real first hour. (`least(existing, new)` keeps the
// true value once recorded, so this only bites a wiped or freshly seeded table.)
// Without a guard, a reseed long after a league started would make an OLD league
// look newer than the announced start and get published as one we just saw
// appear. A genuine first_seen_at is fixed and drifts away from the moving floor;
// a clamped one tracks it forever — which is exactly what this detects.
const AGGREGATE_WINDOW_MS = 7 * 24 * 3_600_000;
const CLAMP_TOLERANCE_MS = 2 * 3_600_000;
const looksClampedToWindow = (firstSeenMs, now) =>
  Math.abs(firstSeenMs - (now - AGGREGATE_WINDOW_MS)) <= CLAMP_TOLERANCE_MS;

// A real new league prices this many hours inside its first day. Anything
// thinner is not something we are willing to name as the current league.
const MIN_OBSERVED_HOURS = 24;

/**
 * The newest public, non-permanent league in a set of league_meta rows, by the
 * first hour we priced it. Rows with no usable firstSeenAt, and rows dated in
 * the future (clock skew, a bogus candle hour), cannot win "newest".
 * Deterministic: ties break on league name ascending.
 */
function newestObservedLeague(rows, now) {
  const candidates = (Array.isArray(rows) ? rows : [])
    .map((row) => ({ row, firstSeenMs: toEpochMs(row?.firstSeenAt) }))
    .filter(({ row, firstSeenMs }) => {
      if (!row || typeof row.league !== "string" || !row.league.trim()) return false;
      if (firstSeenMs == null || firstSeenMs > now) return false;
      // The stored flags were computed when the row was WRITTEN, so a league
      // whose variant spelling we only learned to recognise later still carries
      // the old verdict until the next hourly refresh. Either source saying
      // "private" or "permanent" is enough to disqualify it.
      if (row.isPublic === false || !isPublicLeague(row.league)) return false;
      return !row.isPermanent && !isPermanentLeague(row.league, "poe2");
    });
  if (!candidates.length) return null;
  return candidates.reduce((winner, candidate) => {
    if (candidate.firstSeenMs !== winner.firstSeenMs) {
      return candidate.firstSeenMs > winner.firstSeenMs ? candidate : winner;
    }
    return candidate.row.league < winner.row.league ? candidate : winner;
  });
}

/**
 * Pure half of resolveGuideLeague: league_meta rows in, one of the three cases
 * out. Exported for tests and for any caller that already holds the rows.
 *
 *  - "announced" — nothing observed is newer than what GGG announced (including
 *    the no-data case). The page says exactly what it says today.
 *  - "confirmed" — the newest observed league IS the announced one, so we can
 *    add the hour we first priced it without claiming anything new.
 *  - "observed"  — a newer league than the announced one is trading. We know its
 *    name, its first priced hour and its depth, and nothing else: no mechanics.
 */
export function pickGuideLeague(rows, { now = Date.now(), announced = announcedLeague } = {}) {
  const fallback = { kind: "announced", league: announced };
  const best = newestObservedLeague(rows, now);
  if (!best) return fallback;

  const { row, firstSeenMs } = best;
  const firstSeenAt = new Date(firstSeenMs).toISOString();
  const firstSeenAtUtc = formatUtcInstant(firstSeenMs);

  // A first-seen hour we cannot trust is simply not published: the curated
  // announcement is always a correct thing to say.
  if (looksClampedToWindow(firstSeenMs, now)) return fallback;

  if (sameLeagueName(row.league, announced.name)) {
    return { kind: "confirmed", league: { ...announced, firstSeenAt, firstSeenAtUtc } };
  }

  const announcedStartMs = toEpochMs(announced.startsAtIso);
  if (announcedStartMs != null && firstSeenMs <= announcedStartMs) return fallback;
  // Naming a league GGG never announced is the strongest claim this page makes,
  // so it waits until a day of real hours sits behind it.
  if ((Number(row.completedHours) || 0) < MIN_OBSERVED_HOURS) return fallback;

  return {
    kind: "observed",
    league: {
      name: row.league.trim(),
      firstSeenAt,
      firstSeenAtUtc,
      pairCount: Number(row.pairCount) || 0,
      completedHours: Number(row.completedHours) || 0,
    },
  };
}

const guideTrace = (phase, details = {}) => {
  console.warn(JSON.stringify({ event: "guide-league", phase, ...details }));
};

/**
 * Server-only. Reads poe2 `league_meta` and decides which league the guide is
 * describing. The DB-touching module is imported INSIDE the function so the
 * page's static analysis stays clean (same shape as lib/currency-summary.js).
 *
 * Never throws: no database, no table, or a read error all degrade to the
 * announced league — silently for the reader, traced for us.
 */
export async function resolveGuideLeague({ readMeta = null, now = Date.now(), trace = guideTrace } = {}) {
  try {
    const read = readMeta ?? (await import("./default-league.js")).readLeagueMetaCached;
    const entry = await read("poe2");
    return pickGuideLeague(entry?.rows ?? [], { now });
  } catch (error) {
    // readLeagueMetaCached already swallows database failures, so reaching here
    // means something unexpected — trace it rather than 500 an evergreen page.
    trace("guide-league.resolve.error", { errorMessage: error?.message ?? String(error) });
    return { kind: "announced", league: announcedLeague };
  }
}

/** Plain-text answer for "Which league does this guide cover?", per case. */
function leagueCoverageAnswer(resolved) {
  const evergreen = "It is written to apply to any Path of Exile 2 league start.";
  const a = announcedLeague;
  const announcedFacts =
    `${a.name} (${a.version}), which GGG announced for ${a.startsOn} at ${a.startsAt} (${a.startsAtUtc}). ` +
    `It is an event league with its own fresh economy, and the existing ${a.parallelLeague} league keeps running ` +
    `alongside it rather than being replaced — GGG has said ${a.name} runs until ${a.endsWith} and ends alongside ` +
    `${a.parallelLeague}. So there are two live economies to keep apart when you read a price.`;

  if (resolved?.kind === "observed") {
    const o = resolved.league;
    return (
      `${evergreen} The newest league our own hourly data has seen on the exchange is ${o.name}, first priced on ` +
      `${o.firstSeenAtUtc}, with ${plural(o.pairCount, "market")} across ` +
      `${plural(o.completedHours, "completed hour")} so far. That is an ` +
      `observation from the exchange feed, not an announcement: we do not have official details for it, so the ` +
      `league notes further down still describe ${a.name} (${a.version}), the last league we hold official sources ` +
      `for. The mechanics described here are meant to carry over to whatever launches after that.`
    );
  }

  if (resolved?.kind === "confirmed") {
    const firstSeen = resolved.league?.firstSeenAtUtc;
    const seen = firstSeen
      ? ` Our own hourly data first saw ${a.name} priced on the exchange on ${firstSeen}.`
      : "";
    return `${evergreen} The league start it was last updated for is ${announcedFacts}${seen} The mechanics described here are meant to carry over to whatever launches after that.`;
  }

  return `${evergreen} The league start it was last updated for is ${announcedFacts} The mechanics described here are meant to carry over to whatever launches after that.`;
}

/**
 * The FAQ list, as a function of the resolved league — the page renders it and
 * serializes it into FAQPage JSON-LD, so every answer stays plain text.
 */
export function buildFaqs(resolved = { kind: "announced", league: announcedLeague }) {
  return [
    {
      q: "What currency should I buy at league start in PoE2?",
      a: "There is no single right answer, and anyone who names one is guessing. In mechanism terms, the currencies that are safest to hold early are the ones everybody produces and consumes — the everyday crafting orbs — because you can actually get out of them again. The riskiest are the ones carrying the biggest early scarcity premium, since that premium tends to erode as supply catches up. Decide from the liquidity and hourly range you can see, not from a prediction.",
    },
    {
      q: "Is league start a good time to flip currency in PoE2?",
      a: "League start is when prices move most, and that cuts both ways: wider swings mean more opportunity and a higher chance of being stuck holding something thin that nobody is buying yet. If you trade early, size positions against how liquid the market is rather than against how far it has moved.",
    },
    {
      q: "Why do PoE2 currency prices swing so much on day 1?",
      a: "Supply of everything starts at zero and arrives at different speeds, demand is concentrated on the same handful of progression items, and very few trades have happened. When a market has only a few trades in it, each one moves the quoted range a long way — so early prices are a market being discovered, not a settled market being nudged.",
    },
    {
      q: "When do PoE2 currency prices stabilise after a league launch?",
      a: "There is no fixed day. Prices generally steady as supply catches up with the front-loaded demand, which happens sooner for common bulk currencies and later for high-value endgame ones. Rather than waiting for a date, watch for the 24h move to shrink and the hourly low/high range to narrow on the markets you care about.",
    },
    {
      q: "Does this tracker have data on day 1 of a new league?",
      a: "It follows the official hourly currency exchange feed, so a new league is covered once it is published there and the tracker is pointed at it. Expect the first day to be thin: fewer samples per hour and wider low/high ranges. Treat those early readings as low-confidence context and confirm any price in game.",
    },
    {
      q: "Which league does this guide cover?",
      a: leagueCoverageAnswer(resolved),
    },
  ];
}
