import { usagePayload } from "./usage-events.js";

const sent = new Set();

/** Approximate browser-day usage markers; no retries and no individual IDs. */
export function recordUsage(event, { game, sourceMode } = {}) {
  if (typeof window === "undefined" || sourceMode !== "official") return false;
  if (navigator.doNotTrack === "1" || navigator.globalPrivacyControl === true) return false;
  if (!usagePayload({ event, game })) return false;
  const day = new Date().toISOString().slice(0, 10);
  const marker = `exileradar.usage.v1:${game}:${event}`;
  const key = `${marker}:${day}`;
  try {
    if (sent.has(key) || window.localStorage.getItem(marker) === day) return false;
    // Reserve durably before sending. Losing a count is preferable to inflation.
    window.localStorage.setItem(marker, day);
  } catch { return false; }
  sent.add(key);
  try {
    void fetch("/api/usage", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, game }), keepalive: true,
      signal: AbortSignal.timeout(5000),
    }).catch(() => {});
  } catch { /* Analytics must never interrupt the market flow. */ }
  return true;
}
