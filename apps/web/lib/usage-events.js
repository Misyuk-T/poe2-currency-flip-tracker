// Only coarse product usage leaves the browser. Never add user-entered fields.
export const USAGE_EVENTS = Object.freeze([
  "market_opened", "market_saved",
  "saved_markets_returned", "manual_price_applied",
]);

export function usagePayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (Object.keys(value).some((key) => !["event", "game"].includes(key))) return null;
  if (!USAGE_EVENTS.includes(value.event) || !["poe1", "poe2"].includes(value.game)) return null;
  return { event: value.event, game: value.game };
}
