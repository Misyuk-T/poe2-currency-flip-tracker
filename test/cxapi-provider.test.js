import test from "node:test";
import assert from "node:assert/strict";
import { createGggCxapiProvider } from "../src/providers/ggg-cxapi-provider.js";

test("cxapi provider is disabled without OAuth and never exposes token", async () => {
  const p = createGggCxapiProvider({ poeRealm: "poe2", cxapiAccessToken: null, cxapiTimeoutMs: 1000, userAgent: "x" });
  assert.equal(p.configured, false);
  await assert.rejects(() => p.fetchDigest(), (e) => e.code === "not-configured");
  assert.equal(JSON.stringify(p).includes("Bearer"), false);
});

test("cxapi provider sends OAuth server-side and infers first digest from next cursor", async () => {
  let seen;
  const p = createGggCxapiProvider({
    poeRealm: "poe2", cxapiAccessToken: "secret", cxapiTimeoutMs: 1000, userAgent: "agent",
    _cxFetch: async (url, opts) => {
      seen = { url, authorization: opts.headers.Authorization };
      return { ok: true, status: 200, async json() { return { next_change_id: 7200, markets: [] }; } };
    },
  });
  const d = await p.fetchDigest();
  assert.equal(d.digestId, 3600);
  assert.equal(seen.authorization, "Bearer secret");
  assert.ok(seen.url.endsWith("/poe2"));
});
