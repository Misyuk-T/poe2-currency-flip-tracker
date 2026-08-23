import test from "node:test";
import assert from "node:assert/strict";
import { sitemapXml } from "../apps/web/lib/sitemap-xml.js";

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
