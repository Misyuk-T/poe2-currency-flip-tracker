/**
 * Rate-limit header handling for GGG API calls.
 *
 * GGG's developer documentation requires clients to parse and follow the
 * rate-limit response headers rather than just reacting to a 429. The headers
 * come in pairs: `X-Rate-Limit-{rule}` declares the policy as
 * `hits:period:penalty` groups, and `X-Rate-Limit-{rule}-State` reports the
 * current `hits:period:remaining-penalty` for the same groups. `Retry-After`,
 * when present, is authoritative — it is the server telling us exactly how long
 * to wait, so it always wins over anything we infer.
 *
 * Pure functions over a headers object so this is testable without a network.
 */

const RULES_HEADER = "x-rate-limit-rules";

function headerValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === "function") return headers.get(name);
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value;
  }
  return null;
}

/** Parse `a:b:c,d:e:f` into [{hits, periodSeconds, penaltySeconds}, …]. */
function parseGroups(raw) {
  if (!raw) return [];
  return String(raw)
    .split(",")
    .map((group) => group.trim())
    .filter(Boolean)
    .map((group) => {
      const [hits, period, penalty] = group.split(":").map((part) => Number(part));
      return {
        hits: Number.isFinite(hits) ? hits : null,
        periodSeconds: Number.isFinite(period) ? period : null,
        penaltySeconds: Number.isFinite(penalty) ? penalty : null,
      };
    });
}

/**
 * Read the rate-limit picture out of a response's headers.
 *
 * @returns {{ rules: string[], states: object[], retryAfterSeconds: number|null,
 *             penaltySeconds: number, shouldBackOff: boolean }}
 */
export function readRateLimit(headers) {
  const rules = String(headerValue(headers, RULES_HEADER) ?? "")
    .split(",")
    .map((rule) => rule.trim())
    .filter(Boolean);

  const states = [];
  for (const rule of rules) {
    const policy = parseGroups(headerValue(headers, `x-rate-limit-${rule.toLowerCase()}`));
    const state = parseGroups(headerValue(headers, `x-rate-limit-${rule.toLowerCase()}-state`));
    state.forEach((entry, index) => {
      states.push({
        rule,
        hits: entry.hits,
        periodSeconds: entry.periodSeconds,
        // In the -State header the third field is the REMAINING penalty, i.e.
        // how long we are currently being timed out for.
        penaltySeconds: entry.penaltySeconds,
        limit: policy[index]?.hits ?? null,
      });
    });
  }

  // Absent must stay null, not 0: `Number(null)` is 0, and a 0 here would win
  // the `??` below and silently cancel a real penalty from the state header.
  const retryAfterHeader = headerValue(headers, "retry-after");
  const retryAfterRaw = retryAfterHeader == null || retryAfterHeader === "" ? NaN : Number(retryAfterHeader);
  const retryAfterSeconds = Number.isFinite(retryAfterRaw) && retryAfterRaw >= 0 ? retryAfterRaw : null;
  const activePenalty = states.reduce(
    (max, entry) => (Number.isFinite(entry.penaltySeconds) ? Math.max(max, entry.penaltySeconds) : max),
    0,
  );
  const penaltySeconds = retryAfterSeconds ?? activePenalty;

  return {
    rules,
    states,
    retryAfterSeconds,
    penaltySeconds,
    shouldBackOff: penaltySeconds > 0,
  };
}

/**
 * How long to wait before the next request, in milliseconds.
 *
 * `Retry-After` wins outright when present. Otherwise fall back to the largest
 * remaining penalty across the rules. Capped so a malformed or hostile header
 * can't park a serverless invocation until the platform kills it.
 */
export function backoffMs(headers, { maxMs = 60_000 } = {}) {
  const { penaltySeconds } = readRateLimit(headers);
  if (!(penaltySeconds > 0)) return 0;
  return Math.min(penaltySeconds * 1000, maxMs);
}
