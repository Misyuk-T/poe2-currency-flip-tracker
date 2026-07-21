import test from "node:test";
import assert from "node:assert/strict";
import { createCxapiProvider } from "../src/providers/create-cxapi-provider.js";

const base = { poeRealm: "poe2", cxapiTimeoutMs: 1000, userAgent: "agent" };

test("selector defaults to the public CDN provider", () => {
  const p = createCxapiProvider({ ...base, cxapiSource: "cdn", cxapiAccessToken: null });
  assert.match(p.label, /CDN/);
  assert.equal(p.configured, true); // CDN is public
});

test("selector uses the OAuth provider when cxapiSource=oauth", () => {
  const withToken = createCxapiProvider({ ...base, cxapiSource: "oauth", cxapiAccessToken: "secret" });
  assert.match(withToken.label, /Official/);
  assert.equal(withToken.configured, true);

  const noToken = createCxapiProvider({ ...base, cxapiSource: "oauth", cxapiAccessToken: null });
  assert.equal(noToken.configured, false); // OAuth without a token is disabled
});
