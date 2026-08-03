const DAY_MS = 24 * 60 * 60 * 1000;

export const POE1_LEGACY_LEAGUES_URL =
  "https://api.pathofexile.com/leagues?type=main&realm=pc&limit=50";

function validDate(value) {
  if (typeof value !== "string" || !value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? { value, timestamp } : null;
}
export function leagueDay(startAt, now = Date.now()) {
  const start = validDate(startAt);
  if (!start || !Number.isFinite(now) || start.timestamp > now) return null;
  return Math.floor((now - start.timestamp) / DAY_MS) + 1;
}

/**
 * Normalize only the small, non-sensitive subset needed by the header chip.
 * The legacy endpoint mixes permanent leagues with the current challenge
 * family; category.current is the discriminator supplied by GGG.
 */
export function selectPoe1LeagueMeta(entries, league, now = Date.now()) {
  if (!Array.isArray(entries) || typeof league !== "string" || !league.trim()) {
    return { available: false };
  }

  const entry = entries.find((candidate) => candidate?.id === league);
  if (!entry || entry.realm !== "pc") return { available: false };

  const start = validDate(entry.startAt);
  const end = validDate(entry.endAt);
  const current = entry.category?.current === true;
  const permanent = entry.category?.id === "Standard";

  if (permanent) {
    return {
      available: true,
      league: entry.id,
      kind: "permanent",
      source: "ggg-legacy",
    };
  }

  const dayNumber = current && start ? leagueDay(start.value, now) : null;
  if (!current || !dayNumber) return { available: false };

  const daysRemaining = end && end.timestamp >= now
    ? Math.max(0, Math.ceil((end.timestamp - now) / DAY_MS))
    : null;

  return {
    available: true,
    league: entry.id,
    kind: "challenge",
    current: true,
    startAt: start.value,
    endAt: end?.value ?? null,
    dayNumber,
    daysRemaining,
    source: "ggg-legacy",
  };
}
