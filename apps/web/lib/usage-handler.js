import { usagePayload } from "./usage-events.js";

const MAX_BYTES = 256;
const reply = (status) => new Response(null, { status, headers: { "Cache-Control": "no-store" } });

/** Bounded, per-instance protection, not a distributed anti-bot guarantee. */
export function createUsageLimiter({ now = Date.now, limit = 30, maxKeys = 1000 } = {}) {
  const buckets = new Map();
  return (key) => {
    const time = now();
    for (const [id, entry] of buckets) if (time >= entry.until) buckets.delete(id);
    let entry = buckets.get(key);
    if (!entry) {
      if (buckets.size >= maxKeys) return false;
      entry = { until: time + 60_000, count: 0 };
      buckets.set(key, entry);
    }
    return ++entry.count <= limit;
  };
}

async function boundedJson(request) {
  if (Number(request.headers.get("content-length")) > MAX_BYTES) throw new Error("large");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("empty");
  let size = 0;
  const parts = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw new Error("large"); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function handleUsage(request, { record, allow = () => true }) {
  if (request.method !== "POST") return reply(405);
  if (request.headers.get("origin") !== new URL(request.url).origin) return reply(403);
  if (request.headers.get("sec-fetch-site") === "cross-site") return reply(403);
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return reply(415);
  if (request.headers.get("dnt") === "1" || request.headers.get("sec-gpc") === "1") return reply(204);
  // Used only in this bounded memory map. Never logged or persisted.
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim().slice(0, 64) || "unknown";
  if (!allow(ip)) return reply(429);
  let payload;
  try { payload = usagePayload(await boundedJson(request)); } catch { return reply(400); }
  if (!payload) return reply(400);
  try {
    await record(payload);
    return reply(204);
  } catch { return reply(503); }
}
