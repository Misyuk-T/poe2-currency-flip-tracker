/**
 * MarketProvider interface + factory.
 *
 * A MarketProvider isolates *where executable offers come from* from the rest
 * of the app. The domain layer never talks to HTTP or fixtures directly.
 *
 * Interface:
 *   provider.mode            -> "fixture" | "live"
 *   provider.label           -> human-readable source label
 *   async fetchExchange({ have: string[], want: string[] })
 *       -> { id: string, result: Record<string, listing> }   // raw GGG shape
 *
 * The raw shape is intentionally preserved (result is an object keyed by
 * listing id) so that `domain/offers.normalizeResult` is the single place that
 * understands the GGG contract. Swapping providers must not change parsing.
 */

import { createFixtureProvider } from "./fixture-provider.js";
import { createGggExchangeProvider } from "./ggg-exchange-provider.js";

/**
 * @param {import("../server/config.js").AppConfig} config
 * @returns {Promise<MarketProvider>|MarketProvider}
 */
export function createProvider(config) {
  if (config.providerMode === "live") {
    return createGggExchangeProvider(config);
  }
  return createFixtureProvider(config);
}
