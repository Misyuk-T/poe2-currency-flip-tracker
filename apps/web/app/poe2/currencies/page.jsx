import { iconUrl, popularCurrencies, formatNumber, formatPercent, displayDigits } from "../../../lib/market.js";

// Incremental Static Regeneration: a crawlable static index that still tracks
// the latest stored hour. Refreshes hourly alongside the per-currency pages.
export const revalidate = 3600;

export const metadata = {
  title: "PoE2 Currency Prices and Market Pages",
  description:
    "Browse Path of Exile 2 currency markets with hourly prices and 24h moves for Divine Orb, Exalted Orb, Chaos Orb and more.",
};

function priceLabel(stat, anchor) {
  if (!stat || !Number.isFinite(stat.reference)) return null;
  return `${formatNumber(stat.reference, { maximumFractionDigits: displayDigits(stat.reference) })} ${anchor}`;
}

export default async function CurrenciesPage() {
  // Best-effort: a DB/build hiccup must not fail the page — fall back to static
  // copy. Imported dynamically so the DB driver stays out of Next's page-config
  // collection pass (which evaluates the module graph in a VM context).
  let index = null;
  try {
    const { getCurrencyIndex } = await import("../../../lib/currency-summary.js");
    index = await getCurrencyIndex();
  } catch {
    index = null;
  }

  const anchor = index?.anchor;
  const isSample = index?.sourceMode === "fixture";

  return (
    <main>
      <section className="page-heading">
        <p className="eyebrow">
          Currency index{index?.latestCompletedHour ? ` · as of ${index.latestCompletedHour}` : ""}
          {isSample ? " · sample data" : ""}
        </p>
        <h1>PoE2 currency markets</h1>
        <p>
          Hourly prices and 24h moves for the currencies people search before planning a flip
          {anchor ? `, priced against ${anchor}.` : "."}
        </p>
      </section>
      <div className="currency-grid">
        {popularCurrencies.map((currency) => {
          const stat = index?.byId?.[currency.id] ?? null;
          const price = priceLabel(stat, anchor);
          const move = stat?.movement?.h24;
          return (
            <a className="currency-card with-icon" href={`/poe2/currencies/${currency.id}`} key={currency.id}>
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
    </main>
  );
}
