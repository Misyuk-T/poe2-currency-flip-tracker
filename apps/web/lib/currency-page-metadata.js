/**
 * The `metadata` object for one /poe2/currencies/[id] page, as plain JS.
 *
 * Split out of the page component only so it is directly testable: the page is
 * JSX and the test runner is bare `node --test`, so a rule that only lived in
 * page.jsx could not be asserted — which is exactly the kind of thing that
 * silently stops emitting a robots tag or starts advertising a broken URL.
 */

import { currencyPagePath, currencyPageRobots } from "./currency-indexability.js";
import { currencyName, siteUrl } from "./market.js";

export function currencyPageMetadata({ id } = {}) {
  const name = currencyName(id);
  return {
    title: `${name} Price — PoE2 Hourly Market Data`,
    // Deliberately no live figure: at this crawl rate a baked-in price would sit
    // stale in the SERP for weeks, and Google rewrites most descriptions anyway.
    // Live numbers belong in the body and JSON-LD.
    description: `Hourly ${name} price, range and 24h move in Path of Exile 2, with conservative flip planning.`,
    // Self-referential, and specifically NOT `${siteUrl}/poe2/currencies/${id}`:
    // for the eight ids that are still raw metadata paths, that expression emits
    // a multi-segment URL that 404s while the page itself answers 200 at the
    // percent-encoded form. A page that resolves must not point its canonical at
    // one that does not. Unchanged for every routable id.
    alternates: { canonical: `${siteUrl}${currencyPagePath(id)}` },
    // An unroutable id is `noindex, follow` and is dropped from the sitemap by
    // the SAME rule (apps/web/lib/currency-indexability.js) — never one without
    // the other. `follow` is deliberate: the page stays live and its links stay
    // crawlable, so it is never an orphan.
    robots: currencyPageRobots({ id }),
  };
}
