import test from "node:test";
import assert from "node:assert/strict";

// No database configured: getSql() returns null, the currency index comes back
// empty and the sitemap degrades to the hardcoded popular pages. Unset before
// importing the route so the test can never reach a live database.
delete process.env.DATABASE_URL;

const { GET, dynamic, runtime, maxDuration } = await import("../apps/web/app/sitemap.xml/route.js");

// The freeze this route exists to avoid was a caching bug, not a rendering bug:
// the body was correct, it just never got rebuilt. So the things worth pinning
// at the route level are the segment config and the headers it actually ships.

test("the sitemap route renders per request instead of relying on ISR", () => {
  assert.equal(dynamic, "force-dynamic");
});

test("the sitemap route has room for a cold database read", () => {
  // A lambda timeout is not a JS throw, so the handler's try/catch cannot
  // degrade it — too tight a budget turns a slow read into a 5xx for crawlers.
  assert.equal(runtime, "nodejs");
  assert.ok(maxDuration >= 30);
});

test("with no database behind it the route ships a degraded, uncached sitemap", async () => {
  const response = await GET();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/xml; charset=utf-8");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("vercel-cdn-cache-control"), null);

  const body = await response.text();
  assert.match(body, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.match(body, /\/poe2<\/loc>/);
});
