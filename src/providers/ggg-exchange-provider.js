/**
 * EXPERIMENTAL live MarketProvider for GGG's undocumented `trade2/exchange`
 * endpoint. Enabled ONLY via PROVIDER_MODE=live.
 *
 * Legal/API caution (see README): this is a website-internal, undocumented
 * endpoint, NOT the supported third-party OAuth API and NOT approved for
 * commercial use. Isolated here on purpose. Server-side only: no secrets are
 * ever exposed to the browser. Does not rotate IPs/accounts.
 *
 * Correctness notes vs. the old prototype:
 *   - request body uses top-level `exchange` (no wrapping `query`);
 *   - response `result` is an object keyed by listing id — returned as-is;
 *   - there is NO separate `/fetch` call.
 */

import { createRateLimiter } from "./rate-limit.js";

export function createGggExchangeProvider(config) {
  const base = `https://www.pathofexile.com/api/trade2/exchange/${encodeURIComponent(
    config.poeRealm,
  )}/${encodeURIComponent(config.league)}`;
  const limiter = createRateLimiter();
  const fetchImpl = config._fetch ?? globalThis.fetch;

  return {
    mode: "live",
    label: `Live GGG trade2 exchange — ${config.league} (experimental, unapproved)`,
    async fetchExchange({ have, want }) {
      if (want.length > 10) {
        throw new ExchangeError(
          "too-many-want",
          `Refusing batch of ${want.length} want items; observed cap is ~10 (use 3-5).`,
        );
      }
      const body = JSON.stringify({
        exchange: { status: { option: "online" }, have, want },
        sort: { have: "asc" },
      });

      const headers = {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": config.userAgent,
      };
      if (config.contactEmail) headers["X-Contact"] = config.contactEmail;
      if (config.poesessid) headers["Cookie"] = `POESESSID=${config.poesessid}`;

      // Conservative self-throttle from observed rate-limit headers.
      await sleep(limiter.nextDelayMs());
      limiter.record();

      let response;
      try {
        response = await fetchImpl(base, { method: "POST", headers, body });
      } catch (err) {
        throw new ExchangeError("network", `Exchange request failed: ${err.message}`, { cause: err });
      }

      limiter.updateFromHeaders(response.headers);

      if (response.status === 429) {
        const retryAfter = headerGet(response.headers, "retry-after");
        limiter.penalize(retryAfter);
        throw new ExchangeError("rate-limited", `429 from exchange; retry-after=${retryAfter ?? "?"}s`);
      }
      if (!response.ok) {
        throw new ExchangeError("http", `Exchange returned ${response.status} ${response.statusText}`);
      }

      const payload = await response.json();
      if (payload == null || typeof payload !== "object" || typeof payload.result !== "object") {
        throw new ExchangeError("malformed", "Exchange response missing object `result`.");
      }
      return { id: payload.id ?? null, result: payload.result };
    },
  };
}

export class ExchangeError extends Error {
  constructor(code, message, opts) {
    super(message, opts);
    this.name = "ExchangeError";
    this.code = code;
  }
}

function headerGet(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === "function") return headers.get(name);
  return headers[name] ?? null;
}

function sleep(ms) {
  if (!ms || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
