/**
 * ONE rule for "may this currency page be advertised and indexed?" — read by
 * the sitemap (`currencySitemapUrls`) and by the page's own `robots` metadata
 * (apps/web/app/poe2/currencies/[id]/page.jsx). Both must agree: a URL we tell
 * crawlers not to index must not be advertised in the sitemap, and a URL in the
 * sitemap must not tell the crawler to go away when it arrives.
 *
 * WHAT THIS RULE DOES *NOT* DO, and why that is the finding.
 * This module was written to carry a thin-page threshold — deindex the shallow
 * tail of ~628 currency pages to stop them eating a starved crawl budget. The
 * audit that was supposed to justify the threshold disproved it instead:
 * 84% of currency pages have three days or more of hourly price history, and
 * the only depth measure both call sites can compute (`samples`) turned out to
 * measure the wrong thing. `samples` counts priced hours in the 24h before a
 * market's OWN latest priced hour, so a market that stopped trading months ago
 * keeps its last healthy count forever, while a market that just appeared is
 * scored 1. The rule would have deindexed NEW listings — `temporalis`,
 * `the-arbiters-reliquary-key`, `aldurs-saga` — which are exactly the
 * high-intent `<item> price` queries that produce this site's few clicks, and
 * 25 markets in this league took over 24h (worst: 102h) to reach three priced
 * hours. With the currency index linking 6 of 628 pages, the sitemap is the
 * only discovery path those pages have. Hiding a brand-new item for days during
 * the week it is most searched is worse than doing nothing, and "renders — for
 * the 24h move" is not evidence that a reader was harmed.
 *
 * So there is no depth threshold here. The measured distributions, the SQL and
 * the threshold sensitivity table are kept in docs/THIN-PAGE-AUDIT-2026-09.md
 * for whenever a threshold is revisited on real evidence.
 *
 * WHAT REMAINS is the one unambiguous defect the audit did find: eight rows
 * carry a raw metadata path as their id, because the identity build has no
 * short id for the item yet. `${siteUrl}/poe2/currencies/${id}` then emits
 * `/poe2/currencies/Metadata/Items/SoulCores/IdolPanther` — four segments
 * against a one-segment dynamic route, which 404s. Advertising a 404 to a
 * crawl-budget-starved Googlebot is waste with no upside, so those URLs are
 * excluded from the sitemap and their pages are `noindex, follow`.
 *
 * HONESTY. `noindex, follow` — not `nofollow`, not a 404, not removal from the
 * UI. Every page stays live, stays linked and keeps its own links crawlable. No
 * page with real data is hidden: the excluded eight are among the BUSIEST
 * markets on the site (18-25 samples, 109-173 priced hours in the 7-day
 * window), which is exactly why the real fix is to give them short ids rather
 * than to hide them. That work is filed as a follow-up in the audit doc; the
 * exclusion here simply stops matching once the ids are real, with no deploy.
 */

import { contentFor } from "./currency-content.js";

/**
 * A currency id that can address this route: exactly one URL path segment, no
 * slashes and no whitespace. Deliberately permissive about everything else —
 * real ids include accents ("mórrigans-insight") and that is fine.
 */
export function isUsableCurrencySlug(id) {
  return typeof id === "string" && id.length > 0 && !/[/\s]/.test(id);
}

/**
 * Site-root-relative path that actually RESOLVES for this id.
 *
 * A usable slug is emitted verbatim — 620-odd live canonicals must not churn
 * into percent-encoded equivalents for cosmetics. An unusable one is
 * percent-encoded into the single path segment the route really matches: the
 * raw form 404s while the encoded form returns 200, so an unencoded canonical
 * on those pages is a resolving page pointing at a URL that does not exist.
 * Self-referential is the honest claim; combined with the `noindex` below it
 * asks for nothing, it just stops lying.
 */
export function currencyPagePath(id) {
  return `/poe2/currencies/${isUsableCurrencySlug(id) ? id : encodeURIComponent(id ?? "")}`;
}

/**
 * The single classification, shared by the sitemap and the page metadata.
 * `{ index: false }` means BOTH "not in the sitemap" and "noindex, follow".
 */
export function classifyCurrencyPage({ id } = {}) {
  if (!isUsableCurrencySlug(id)) return { index: false, reason: "unusable-slug" };
  // Unique hand-written copy, for the six popular currencies. Reported
  // separately because it is the reason those pages stay listed even on the
  // degraded, no-database sitemap path.
  if (contentFor(id)) return { index: true, reason: "editorial-content" };
  return { index: true, reason: "indexable" };
}

/** Convenience for call sites that only need the boolean. */
export function shouldIndexCurrencyPage(input) {
  return classifyCurrencyPage(input).index;
}

/**
 * Next.js `metadata.robots` for one currency page. `undefined` leaves the
 * site-wide default (indexable) alone; an unroutable id is hidden from the
 * index but its links stay crawlable.
 */
export function currencyPageRobots(input) {
  return shouldIndexCurrencyPage(input) ? undefined : { index: false, follow: true };
}
