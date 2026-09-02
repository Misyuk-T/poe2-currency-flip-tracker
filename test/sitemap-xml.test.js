import test from "node:test";
import assert from "node:assert/strict";
import { sitemapXml, sitemapResponseHeaders } from "../apps/web/lib/sitemap-xml.js";

test("sitemapXml emits a sitemaps.org 0.9 urlset", () => {
  const xml = sitemapXml([
    {
      url: "https://exileradar.com/poe2",
      lastModified: new Date("2026-08-23T15:00:00.000Z"),
      changeFrequency: "hourly",
      priority: 1,
    },
  ]);

  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n/);
  assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.match(xml, /<loc>https:\/\/exileradar\.com\/poe2<\/loc>/);
  assert.match(xml, /<lastmod>2026-08-23T15:00:00\.000Z<\/lastmod>/);
  assert.match(xml, /<changefreq>hourly<\/changefreq>/);
  assert.match(xml, /<priority>1<\/priority>/);
  assert.match(xml, /<\/urlset>\n$/);
});

test("sitemapXml omits lastmod for pages with no data behind them", () => {
  // A churning "now" timestamp on a page with nothing new to say trains
  // crawlers to ignore lastmod, so those entries carry no lastmod at all.
  const xml = sitemapXml([
    { url: "https://exileradar.com/poe2/currencies/chaos", changeFrequency: "daily", priority: 0.7 },
  ]);

  assert.doesNotMatch(xml, /<lastmod>/);
  assert.match(xml, /<changefreq>daily<\/changefreq>/);
});

test("sitemapXml escapes XML metacharacters in urls", () => {
  const xml = sitemapXml([{ url: "https://exileradar.com/poe2?a=1&b=2" }]);

  assert.match(xml, /<loc>https:\/\/exileradar\.com\/poe2\?a=1&amp;b=2<\/loc>/);
});

test("a healthy sitemap is CDN-cached for an hour, and the browser always revalidates", () => {
  // `revalidate` never fired for this route on Vercel and froze every lastmod
  // for days; the edge TTL is the freshness mechanism now, so pin it. Vercel
  // reads the CDN-* headers for forced-dynamic handlers, not `s-maxage`.
  const h = sitemapResponseHeaders();

  assert.equal(h["Content-Type"], "application/xml; charset=utf-8");
  assert.equal(h["Vercel-CDN-Cache-Control"], "public, s-maxage=3600");
  assert.equal(h["CDN-Cache-Control"], "public, s-maxage=3600");
  assert.equal(h["Cache-Control"], "public, max-age=0, must-revalidate");
});

test("the healthy sitemap carries no stale-while-revalidate window", () => {
  // A sitemap is crawled about once a day. Under a long swr window that means
  // nearly every crawl is served a day-old body while the refresh runs behind
  // it — the same stale lastmods, moved from ISR to the CDN.
  const h = sitemapResponseHeaders();

  assert.doesNotMatch(h["Vercel-CDN-Cache-Control"], /stale-while-revalidate/);
  assert.doesNotMatch(h["CDN-Cache-Control"], /stale-while-revalidate/);
});

test("a degraded sitemap is never cached", () => {
  // Same rule `cacheHeader` applies to errors: a popular-only fallback must not
  // outlive the outage that produced it.
  const h = sitemapResponseHeaders({ degraded: true });

  assert.equal(h["Content-Type"], "application/xml; charset=utf-8");
  assert.equal(h["Cache-Control"], "no-store");
  assert.equal(h["Vercel-CDN-Cache-Control"], undefined);
  assert.equal(h["CDN-Cache-Control"], undefined);
});
