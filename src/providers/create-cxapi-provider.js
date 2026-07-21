/**
 * Select the Currency Exchange history provider from config.
 *
 *  - "cdn"   -> public unauthenticated web.poecdn.com endpoint (default).
 *  - "oauth" -> legacy api.pathofexile.com behind a service:cxapi token.
 *
 * Both expose the same `fetchDigest({ id })` contract, so downstream ingest is
 * source-agnostic. Kept as a single choice point so the two feeds' differing
 * auth and pagination semantics never leak into the ingest loop.
 */

import { createGggCdnCxapiProvider } from "./ggg-cdn-cxapi-provider.js";
import { createGggCxapiProvider } from "./ggg-cxapi-provider.js";

export function createCxapiProvider(config) {
  return config.cxapiSource === "oauth"
    ? createGggCxapiProvider(config)
    : createGggCdnCxapiProvider(config);
}
