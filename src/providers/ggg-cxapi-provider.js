/** Official, OAuth-gated hourly Currency Exchange history provider. */

import { readRateLimit } from "./rate-limit.js";

const BASE = "https://api.pathofexile.com/currency-exchange";

export function createGggCxapiProvider(config) {
  const fetchImpl = config._cxFetch ?? globalThis.fetch;
  const trace = typeof config.cxapiTrace === "function" ? config.cxapiTrace : () => {};
  return {
    mode: config.cxapiAccessToken ? "live" : "disabled",
    label: "Official GGG hourly Currency Exchange API",
    configured: Boolean(config.cxapiAccessToken),
    async fetchDigest({ id = null } = {}) {
      if (!config.cxapiAccessToken) throw new CxapiError("not-configured", "service:cxapi OAuth token is not configured");
      const suffix = id == null ? "" : `/${encodeURIComponent(String(id))}`;
      trace("provider.fetch.request.start", { source: "oauth", realm: config.poeRealm, digestId: id });
      let response;
      try {
        response = await fetchImpl(`${BASE}/${encodeURIComponent(config.poeRealm)}${suffix}`, {
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${config.cxapiAccessToken}`,
            "User-Agent": config.userAgent,
          },
          signal: AbortSignal.timeout(config.cxapiTimeoutMs),
        });
      } catch (err) {
        throw new CxapiError("network", `cxapi request failed: ${err.message}`, { cause: err });
      }
      trace("provider.fetch.headers.end", { source: "oauth", realm: config.poeRealm, digestId: id, status: response.status });
      // GGG's docs require reading the rate-limit headers, not just reacting to
      // a 429. Carry the server's own wait (Retry-After, else the largest
      // remaining penalty) out with the error so the caller honours it.
      const rateLimit = readRateLimit(response.headers);
      if (rateLimit.states.length) {
        trace("provider.rate-limit", { source: "oauth", states: rateLimit.states, penaltySeconds: rateLimit.penaltySeconds });
      }
      if (response.status === 429 || rateLimit.shouldBackOff) {
        throw new CxapiError("rate-limited", `cxapi rate limited; wait ${rateLimit.penaltySeconds}s`, {
          retryAfterSeconds: rateLimit.penaltySeconds,
        });
      }
      if (!response.ok) throw new CxapiError("http", `cxapi returned ${response.status}`);
      trace("provider.fetch.body.start", { source: "oauth", realm: config.poeRealm, digestId: id });
      const payload = await response.json();
      trace("provider.fetch.body.end", { source: "oauth", realm: config.poeRealm, digestId: id, markets: Array.isArray(payload?.markets) ? payload.markets.length : null });
      if (!payload || !Array.isArray(payload.markets)) throw new CxapiError("malformed", "cxapi response missing markets");
      const next = Number(payload.next_change_id);
      const digestId = id == null && Number.isInteger(next) ? next - 3600 : Number(id);
      if (!Number.isInteger(digestId) || digestId <= 0) throw new CxapiError("missing-digest-id", "cannot determine digest hour");
      return { digestId, payload };
    },
  };
}

export class CxapiError extends Error {
  constructor(code, message, opts) {
    super(message, opts);
    this.name = "CxapiError";
    this.code = code;
  }
}
