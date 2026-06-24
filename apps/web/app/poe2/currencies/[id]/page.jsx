import { currencyName, iconUrl, popularCurrencies, siteUrl } from "../../../../lib/market.js";

export async function generateStaticParams() {
  return popularCurrencies.map((currency) => ({ id: currency.id }));
}

export async function generateMetadata({ params }) {
  const { id } = await params;
  const name = currencyName(id);
  return {
    title: `${name} PoE2 market tracker`,
    description: `Track ${name} in Path of Exile 2 with hourly market ranges, manual current price checks and conservative entry/exit planning.`,
    alternates: { canonical: `${siteUrl}/poe2/currencies/${id}` },
  };
}

export default async function CurrencyPage({ params }) {
  const { id } = await params;
  const name = currencyName(id);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: `${name} PoE2 market tracker`,
    description: `Hourly market context and trade planning page for ${name} in Path of Exile 2.`,
    url: `${siteUrl}/poe2/currencies/${id}`,
  };

  return (
    <main>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <section className="currency-hero">
        <img src={iconUrl(id)} alt="" />
        <div>
          <p className="eyebrow">PoE2 currency market</p>
          <h1>{name}</h1>
          <p>
            Use the market radar to compare the latest completed-hour range with the current price you see in game.
            This page is designed for SEO and can later embed a dedicated chart and historical summary.
          </p>
          <a className="button primary" href={`/poe2?currency=${encodeURIComponent(id)}`}>Open in radar</a>
        </div>
      </section>

      <section className="content-section prose">
        <h2>How to read this market</h2>
        <p>
          The tracker treats official hourly data as historical context, not an executable quote. If you enter a current
          observed price, recommendations are rebased onto that working price and evaluated against past hourly windows.
        </p>
        <h2>What the tool can tell you</h2>
        <ul>
          <li>whether the market moved over 1h, 6h and 24h;</li>
          <li>how often similar windows touched a planned exit level;</li>
          <li>whether the latest hourly model is stale or under-sampled.</li>
        </ul>
      </section>
    </main>
  );
}
