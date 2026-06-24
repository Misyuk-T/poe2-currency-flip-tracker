import { iconUrl, popularCurrencies } from "../../../lib/market.js";

export const metadata = {
  title: "PoE2 Currency Prices and Market Pages",
  description:
    "Browse Path of Exile 2 currency markets with SEO-friendly pages for Divine Orb, Exalted Orb, Chaos Orb and more.",
};

export default function CurrenciesPage() {
  return (
    <main>
      <section className="page-heading">
        <p className="eyebrow">Currency index</p>
        <h1>PoE2 currency markets</h1>
        <p>SEO-friendly market pages for currencies people search before planning a flip.</p>
      </section>
      <div className="currency-grid">
        {popularCurrencies.map((currency) => (
          <a className="currency-card with-icon" href={`/poe2/currencies/${currency.id}`} key={currency.id}>
            <img src={iconUrl(currency.id)} alt="" />
            <span>
              <strong>{currency.name}</strong>
              <small>{currency.summary}</small>
            </span>
          </a>
        ))}
      </div>
    </main>
  );
}
