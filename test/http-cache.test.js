import test from "node:test";
import assert from "node:assert/strict";
import { cacheHeader } from "../apps/web/lib/http.js";

test("200 responses are edge-cached via Vercel-CDN-Cache-Control, browser revalidates", () => {
  const h = cacheHeader(200, { sMaxAge: 60, swr: 300 });
  assert.equal(h["Vercel-CDN-Cache-Control"], "public, s-maxage=60, stale-while-revalidate=300");
  assert.equal(h["CDN-Cache-Control"], "public, s-maxage=60, stale-while-revalidate=300");
  assert.equal(h["Cache-Control"], "public, max-age=0, must-revalidate");

  const noSwr = cacheHeader(200, { sMaxAge: 60 });
  assert.equal(noSwr["Vercel-CDN-Cache-Control"], "public, s-maxage=60");
});

test("errors and degraded responses are never cached", () => {
  assert.deepEqual(cacheHeader(503, { sMaxAge: 60, swr: 300 }), { "Cache-Control": "no-store" });
  assert.deepEqual(cacheHeader(502, { sMaxAge: 60 }), { "Cache-Control": "no-store" });
  assert.deepEqual(cacheHeader(400, { sMaxAge: 60 }), { "Cache-Control": "no-store" });
  assert.deepEqual(cacheHeader(200, { sMaxAge: 0 }), { "Cache-Control": "no-store" }); // no TTL → no-store
  assert.deepEqual(cacheHeader(200), { "Cache-Control": "no-store" });
});
