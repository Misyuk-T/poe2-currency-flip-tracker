/** Official, OAuth-gated hourly Currency Exchange history provider. */

const BASE = "https://api.pathofexile.com/currency-exchange";

export function createGggCxapiProvider(config) {
  const fetchImpl = config._cxFetch ?? globalThis.fetch;
  return {
    mode: config.cxapiAccessToken ? "live" : "disabled",
    label: "Official GGG hourly Currency Exchange API",
    configured: Boolean(config.cxapiAccessToken),
    async fetchDigest({ id = null } = {}) {
      if (!config.cxapiAccessToken) throw new CxapiError("not-configured", "service:cxapi OAuth token is not configured");
      const suffix = id == null ? "" : `/${encodeURIComponent(String(id))}`;
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
      if (response.status === 429) throw new CxapiError("rate-limited", "cxapi returned 429");
      if (!response.ok) throw new CxapiError("http", `cxapi returned ${response.status}`);
      const payload = await response.json();
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
