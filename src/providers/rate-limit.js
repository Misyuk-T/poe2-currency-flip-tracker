/**
 * Conservative, header-driven rate limiting for the undocumented GGG exchange
 * endpoint.
 *
 * GGG returns dynamic policy headers, e.g.:
 *   X-Rate-Limit-Policy: trade-exchange-request-limit
 *   X-Rate-Limit-IP:     5:15:60,10:90:300,30:300:1800
 *
 * Each comma-separated rule is `hits:window:penalty` (window/penalty seconds).
 * We never hardcode a rate: we parse the headers and self-throttle to stay
 * under the *tightest* observed rule, with jitter, and obey `Retry-After` on
 * 429. We do NOT rotate IPs or accounts.
 */

/**
 * @typedef {{ hits: number, windowSec: number, penaltySec: number }} RateRule
 */

/**
 * Parse an `X-Rate-Limit-IP` style header value.
 * @param {string|null|undefined} value
 * @returns {RateRule[]}
 */
export function parseRateLimitPolicy(value) {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [hits, windowSec, penaltySec] = part.split(":").map(Number);
      return { hits, windowSec, penaltySec };
    })
    .filter((r) => Number.isFinite(r.hits) && Number.isFinite(r.windowSec) && r.hits > 0);
}

/**
 * A simple sliding-window limiter that records request timestamps and computes
 * how long to wait before the next request so that no parsed rule is violated.
 *
 * @param {{ safetyFraction?: number, jitterMs?: number, now?: () => number }} [opts]
 */
export function createRateLimiter(opts = {}) {
  const safetyFraction = opts.safetyFraction ?? 0.6; // use at most 60% of any bucket
  const jitterMs = opts.jitterMs ?? 250;
  const now = opts.now ?? (() => Date.now());

  /** @type {RateRule[]} */
  let rules = [];
  /** @type {number[]} */
  const history = [];
  let blockedUntil = 0;
  let jitterTick = 0;

  function prune(t) {
    const maxWindow = rules.reduce((m, r) => Math.max(m, r.windowSec), 0) * 1000;
    while (history.length && t - history[0] > maxWindow) history.shift();
  }

  return {
    updateFromHeaders(headers) {
      const ip = parseRateLimitPolicy(headerGet(headers, "x-rate-limit-ip"));
      const account = parseRateLimitPolicy(headerGet(headers, "x-rate-limit-account"));
      const combined = [...ip, ...account];
      if (combined.length) rules = combined;
    },
    /** Note a 429 penalty so the next request waits at least `retryAfterSec`. */
    penalize(retryAfterSec) {
      const sec = Number(retryAfterSec);
      if (Number.isFinite(sec) && sec > 0) blockedUntil = Math.max(blockedUntil, now() + sec * 1000);
    },
    /** Milliseconds to wait before the next request is safe. */
    nextDelayMs() {
      const t = now();
      let delay = Math.max(0, blockedUntil - t);
      prune(t);
      for (const rule of rules) {
        const budget = Math.max(1, Math.floor(rule.hits * safetyFraction));
        const windowMs = rule.windowSec * 1000;
        const inWindow = history.filter((ts) => t - ts < windowMs);
        if (inWindow.length >= budget) {
          // wait until the oldest in-window request ages out of the window.
          const wait = windowMs - (t - inWindow[0]);
          delay = Math.max(delay, wait);
        }
      }
      // Deterministic small jitter (no Math.random, to stay reproducible/testable).
      jitterTick = (jitterTick + 1) % 7;
      return delay + (delay > 0 ? (jitterTick / 7) * jitterMs : 0);
    },
    /** Record that a request was just made. */
    record() {
      history.push(now());
    },
    get rules() {
      return rules;
    },
  };
}

function headerGet(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === "function") return headers.get(name);
  return headers[name] ?? headers[name.toLowerCase()] ?? null;
}
