/**
 * Public, unauthenticated hourly Currency Exchange history provider (CDN).
 *
 * GGG made the Currency Exchange history public via their CDN, so no OAuth
 * `service:cxapi` token is required. Endpoint:
 *
 *   GET https://web.poecdn.com/api/currency-exchange/<realm>[/<id>]
 *
 * Verified CDN semantics (probed live, 2026-07-21):
 *  - `id` is a unix-hour cursor. The response `markets[]` are the digest FOR the
 *    requested hour `id`; `next_change_id` is the NEXT hour to request (id + 3600).
 *  - At the live edge the in-progress hour may return either a terminal payload
 *    (`next_change_id === id`, empty `markets[]`) or HTTP 404 until published.
 *  - No `id` returns the FIRST hour of all history (Dec 2024), NOT the latest.
 *    Callers must supply a recent start id for live catch-up (see config).
 *
 * Because the digest belongs to the REQUESTED hour, `digestId = id`. The OAuth
 * provider's `next_change_id - 3600` derivation is WRONG here: at the terminal it
 * would mislabel the empty in-progress hour as the previous completed hour.
 */

const CDN_BASE = "https://web.poecdn.com/api/currency-exchange";

// Map our realm label -> the CDN path segment. PoE1 PC is the CDN default (no
// segment); poe2/xbox/sony are explicit. Unknown labels pass through verbatim.
const CDN_REALM_SEGMENT = { poe1: "", pc: "", poe2: "poe2", xbox: "xbox", sony: "sony" };

function realmSegment(realm) {
  const seg = CDN_REALM_SEGMENT[realm] ?? realm;
  return seg ? `/${encodeURIComponent(seg)}` : "";
}

export function createGggCdnCxapiProvider(config) {
  const fetchImpl = config._cxFetch ?? globalThis.fetch;
  const now = config._cxNow ?? Date.now;
  const base = config.cxapiCdnBaseUrl ?? CDN_BASE;
  const trace = typeof config.cxapiTrace === "function" ? config.cxapiTrace : () => {};
  return {
    mode: "live",
    label: "Public GGG Currency Exchange CDN",
    // The CDN is public: no credential to gate on, always usable.
    configured: true,
    async fetchDigest({ id = null } = {}) {
      const suffix = id == null ? "" : `/${encodeURIComponent(String(id))}`;
      trace("provider.fetch.request.start", { source: "cdn", realm: config.poeRealm, digestId: id });
      let response;
      try {
        response = await fetchImpl(`${base}${realmSegment(config.poeRealm)}${suffix}`, {
          headers: {
            Accept: "application/json",
            // No Authorization: the CDN endpoint is unauthenticated. Keep an
            // identifiable User-Agent per the third-party API etiquette.
            "User-Agent": config.userAgent,
          },
          signal: AbortSignal.timeout(config.cxapiTimeoutMs),
        });
      } catch (err) {
        throw new CxapiError("network", `cxapi cdn request failed: ${err.message}`, { cause: err });
      }
      trace("provider.fetch.headers.end", { source: "cdn", realm: config.poeRealm, digestId: id, status: response.status });
      if (response.status === 429) throw new CxapiError("rate-limited", "cxapi cdn returned 429");
      // The CDN can expose the cursor for an hour before that hour's object is
      // published. Near the live edge a 404 therefore means "retry this cursor
      // later", not an ingest failure. Return the same terminal shape as the
      // explicit empty response so ingestLive leaves the cursor in place.
      const requestedId = Number(id);
      const currentHour = Math.floor(now() / 3600_000) * 3600;
      if (response.status === 404 && Number.isInteger(requestedId) && requestedId > 0 && requestedId >= currentHour - 3600) {
        trace("provider.fetch.terminal", { source: "cdn", realm: config.poeRealm, digestId: requestedId, status: 404 });
        return { digestId: requestedId, payload: { next_change_id: requestedId, markets: [] } };
      }
      if (!response.ok) throw new CxapiError("http", `cxapi cdn returned ${response.status}`);
      trace("provider.fetch.body.start", { source: "cdn", realm: config.poeRealm, digestId: id });
      const payload = await response.json();
      trace("provider.fetch.body.end", { source: "cdn", realm: config.poeRealm, digestId: id, markets: Array.isArray(payload?.markets) ? payload.markets.length : null });
      if (!payload || !Array.isArray(payload.markets)) throw new CxapiError("malformed", "cxapi cdn response missing markets");
      const next = Number(payload.next_change_id);
      if (!Number.isInteger(next) || next <= 0) throw new CxapiError("malformed", "cxapi cdn response missing next_change_id");
      // The digest is for the requested hour. Bootstrap (no id) resolves to the
      // hour whose completion `next` advertises.
      const digestId = id == null ? next - 3600 : Number(id);
      if (!Number.isInteger(digestId) || digestId <= 0) throw new CxapiError("missing-digest-id", "cannot determine digest hour");
      // Defensive: a real cursor must only stay put (terminal) or move forward.
      // A backward `next_change_id` means a malformed/confused response — never
      // silently accept it as progress.
      if (id != null && next < Number(id)) throw new CxapiError("malformed", "cxapi cdn next_change_id moved backward");
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
