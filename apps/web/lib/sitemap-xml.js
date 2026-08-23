/**
 * Pure sitemaps.org 0.9 serializer, in the same shape Next's `sitemap.js`
 * metadata route emitted. It lives here rather than in the route file because a
 * `route.js` may only export HTTP methods and segment config, and because the
 * XML shape is worth a test that needs no Next runtime.
 */

const XML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (char) => XML_ESCAPES[char]);
}

function urlNode({ url, lastModified, changeFrequency, priority }) {
  const lines = [`<loc>${escapeXml(url)}</loc>`];
  if (lastModified) {
    const stamp = lastModified instanceof Date ? lastModified.toISOString() : lastModified;
    lines.push(`<lastmod>${escapeXml(stamp)}</lastmod>`);
  }
  if (changeFrequency) lines.push(`<changefreq>${escapeXml(changeFrequency)}</changefreq>`);
  if (Number.isFinite(priority)) lines.push(`<priority>${priority}</priority>`);
  return `<url>\n${lines.join("\n")}\n</url>`;
}

export function sitemapXml(entries) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries.map(urlNode),
    "</urlset>",
    "",
  ].join("\n");
}
