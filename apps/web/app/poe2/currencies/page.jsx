import {
  currencyName,
  iconUrl,
  popularCurrencies,
  siteUrl,
  formatNumber,
  formatPercent,
  displayDigits,
} from "../../../lib/market.js";
import { groupCurrenciesByExchangeLayout, UNMAPPED_CATEGORY } from "../../../lib/currency-index-groups.js";
import { currencyPagePath } from "../../../lib/currency-indexability.js";

// Incremental Static Regeneration: a crawlable static index that still tracks
// the latest stored hour. Refreshes hourly alongside the per-currency pages.
export const revalidate = 3600;

export const metadata = {
  title: "PoE2 Currency Prices and Market Pages",
  description:
    "Every Path of Exile 2 currency market with hourly prices and 24h moves — Divine Orb, Exalted Orb, Chaos Orb, essences, runes, omens and more, grouped like the in-game Currency Exchange.",
  alternates: { canonical: `${siteUrl}/poe2/currencies` },
};

function priceLabel(stat, anchor) {
  if (!stat || !Number.isFinite(stat.reference)) return null;
  return `${formatNumber(stat.reference, { maximumFractionDigits: displayDigits(stat.reference) })} ${anchor}`;
}

/** Bare number — the anchor unit is stated once per table, not 600 times. */
function priceCell(stat) {
  if (!stat || !Number.isFinite(stat.reference)) return "—";
  return formatNumber(stat.reference, { maximumFractionDigits: displayDigits(stat.reference) });
}

/**
 * A three-figure move does not need two decimals, and at 375px it is the
 * difference between fitting the column and forcing the whole page to scroll
 * sideways: `+2,532.49%` is ten characters in a ~95px cell. Rounding a move
 * that large away from its hundredths loses nothing a reader could act on.
 */
function moveCell(move) {
  if (!Number.isFinite(move)) return "—";
  return formatPercent(move, { maximumFractionDigits: Math.abs(move) >= 1 ? 0 : 2 });
}

export default async function CurrenciesPage() {
  // Best-effort: a DB/build hiccup must not fail the page — fall back to static
  // copy. Imported dynamically so the DB driver stays out of Next's page-config
  // collection pass (which evaluates the module graph in a VM context).
  let index = null;
  try {
    const { getCurrencyIndex } = await import("../../../lib/currency-summary.js");
    index = await getCurrencyIndex();
    if (!index) console.warn("[currency-index] no index; rendering the static list");
  } catch (error) {
    console.error("[currency-index] index read failed", {
      errorName: error?.name ?? "Error",
      errorCode: error?.code ?? null,
      errorMessage: error?.message ?? String(error),
    });
    index = null;
  }

  // Stored `exchange_layout` rows, layered over the committed snapshot by the
  // grouping module. This is ISR (`revalidate = 3600`), so it is one bounded
  // read per regeneration, not per request — which is why it does not reopen
  // the Phase C "cron-only" decision, taken about /api/radar's hot rebuild
  // path. It earns its place for one week a year: a new league's markets reach
  // the table the next day but the committed JSON only on a monthly PR, so
  // without this they would sit in "Other markets" during the week they are
  // most searched. Never load-bearing — an empty list is exactly the
  // committed-snapshot behaviour.
  let layoutOverrides = null;
  try {
    const { loadLayoutOverrides } = await import("../../../lib/layout-overrides.js");
    layoutOverrides = await loadLayoutOverrides("poe2");
  } catch (error) {
    console.warn("[currency-index] stored layout unavailable; using the committed snapshot", {
      errorName: error?.name ?? "Error",
      errorMessage: error?.message ?? String(error),
    });
    layoutOverrides = null;
  }

  const anchor = index?.anchor;
  const isSample = index?.sourceMode === "fixture";

  // Every market the single index read knows about — the same id set the
  // sitemap lists. Those URLs were being discovered from the sitemap and left
  // uncrawled precisely because nothing on the site linked to them; this list is
  // the link path. `getCurrencyIndex()` returns the whole map in one read, so
  // there is no per-row database work here.
  //
  // EVERY id is linked, including the eight `classifyCurrencyPage` marks
  // `noindex, follow` for carrying a raw metadata path as their id. That is not
  // a contradiction: those pages are excluded from the SITEMAP and ask not to be
  // indexed, but they are live pages with real data (among the busiest markets
  // on the site) and this list is now their only path to being reachable at all.
  // What they must not be is a link to a URL that 404s — `currencyPagePath`
  // percent-encodes an id that is not a single path segment, so the href
  // resolves whether or not the identity build has given the item a short id.
  const entries = Object.values(index?.byId ?? {})
    .filter((stat) => stat?.target && stat.target !== anchor)
    .map((stat) => ({ id: stat.target, name: currencyName(stat.target), stat }));
  const { categories, total } = groupCurrenciesByExchangeLayout(entries, { overrides: layoutOverrides });

  return (
    <main>
      <section className="page-heading">
        <p className="eyebrow">
          Currency index{index?.latestCompletedHour ? ` · as of ${index.latestCompletedHour}` : ""}
          {isSample ? " · sample data" : ""}
        </p>
        <h1>PoE2 currency markets</h1>
        <p>
          {total > 0
            ? `Hourly prices and 24h moves for all ${formatNumber(total)} Path of Exile 2 markets we track`
            : "Hourly prices and 24h moves for the currencies people search before planning a flip"}
          {anchor ? `, priced against ${anchor}` : ""}
          {total > 0 ? ", grouped the way the in-game Currency Exchange groups them." : "."}
        </p>
        {categories.length ? (
          <nav className="ci-jump" aria-label="Currency exchange categories">
            {categories.map((category) => (
              <a href={`#${category.slug}`} key={category.slug}>
                {category.name} <span aria-hidden="true">{category.count}</span>
              </a>
            ))}
          </nav>
        ) : null}
      </section>

      <section className="content-section" aria-labelledby="ci-start-here">
        <div className="section-heading">
          <p className="eyebrow">Start here</p>
          {/* "Featured", not "most-traded": these six are an editorial pick
              with hand-written copy, and the table below holds the volume data
              that would disprove a traded-volume ranking. */}
          <h2 id="ci-start-here">Featured currency markets</h2>
        </div>
        <div className="currency-grid">
          {popularCurrencies.map((currency) => {
            const stat = index?.byId?.[currency.id] ?? null;
            const price = priceLabel(stat, anchor);
            const move = stat?.movement?.h24;
            return (
              <a className="currency-card with-icon" href={currencyPagePath(currency.id)} key={currency.id}>
                <img src={iconUrl(currency.id)} alt="" />
                <span>
                  <strong>{currency.name}</strong>
                  {price ? (
                    <small className="currency-stat">
                      <span className="price">≈ {price}</span>
                      {Number.isFinite(move) ? (
                        <em className={move >= 0 ? "up" : "down"}>{formatPercent(move)} 24h</em>
                      ) : null}
                    </small>
                  ) : null}
                  <small>{currency.summary}</small>
                </span>
              </a>
            );
          })}
        </div>
      </section>

      {categories.map((category) => (
        <section className="content-section ci-group" id={category.slug} key={category.slug} aria-labelledby={`h-${category.slug}`}>
          <div className="section-heading">
            <p className="eyebrow">
              {category.count} market{category.count === 1 ? "" : "s"}
              {anchor ? ` · priced in ${anchor}` : ""}
            </p>
            <h2 id={`h-${category.slug}`}>{category.name}</h2>
          </div>
          {category.sections.map((section) => (
            <table className="ci-table" key={section.name}>
              <caption>{section.name}</caption>
              <thead>
                <tr>
                  <th scope="col">Market</th>
                  <th scope="col">Price{anchor ? ` (${anchor})` : ""}</th>
                  <th scope="col">24h</th>
                </tr>
              </thead>
              <tbody>
                {section.rows.map((row) => {
                  const move = row.stat?.movement?.h24;
                  return (
                    <tr key={row.id}>
                      <th scope="row">
                        <a href={currencyPagePath(row.id)}>{row.name}</a>
                      </th>
                      <td>{priceCell(row.stat)}</td>
                      <td className={Number.isFinite(move) ? (move >= 0 ? "up" : "down") : undefined}>
                        {moveCell(move)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ))}
        </section>
      ))}

      {categories.length ? (
        <section className="content-section prose">
          <h2>How to read this index</h2>
          <p>
            Each price is the midpoint of that market&apos;s latest completed-hour low/high range against{" "}
            {anchor ?? "the anchor currency"} — a labelled proxy from official hourly data, not an executable quote.
            The 24h column compares that midpoint with the one a day earlier. Markets are grouped and ordered the way
            the in-game Currency Exchange groups them
            {categories.some((category) => category.name === UNMAPPED_CATEGORY)
              ? `; a market neither the stored exchange layout nor the committed snapshot places yet is listed under ${UNMAPPED_CATEGORY}`
              : ""}
            .{isSample ? " Values on this page are clearly-labelled sample data until the live feed is enabled." : ""}
          </p>
        </section>
      ) : null}
    </main>
  );
}
