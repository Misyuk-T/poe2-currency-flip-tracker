import { popularCurrencies } from "./../lib/market.js";

export default function HomePage() {
  return (
    <main>
      <section className="hero">
        <p className="eyebrow">Path of Exile 2 market radar</p>
        <h1>Plan PoE2 currency flips from hourly market movement, not vibes.</h1>
        <p className="hero-copy">
          Track official completed-hour currency ranges, enter the price you actually see in game, and get a conservative
          entry/exit plan for 1–24 hour horizons.
        </p>
        <div className="hero-actions">
          <a className="button primary" href="/poe2">Open market radar</a>
          <a className="button" href="/poe2/currencies">Browse currencies</a>
        </div>
      </section>

      <section className="feature-grid" aria-label="Product highlights">
        <article>
          <h2>Official hourly data</h2>
          <p>Uses completed-hour market ranges. The midpoint is labelled honestly and never sold as a live executable quote.</p>
        </article>
        <article>
          <h2>Manual current price</h2>
          <p>Enter the price you see now. The plan rebases historical ranges onto your actual market context.</p>
        </article>
        <article>
          <h2>Overnight planning</h2>
          <p>Historical hit rate and median time-to-hit come from rolling hourly windows, not fake prediction magic.</p>
        </article>
      </section>

      <section className="content-section">
        <div className="section-heading">
          <p className="eyebrow">SEO-ready currency pages</p>
          <h2>Popular markets</h2>
        </div>
        <div className="currency-grid">
          {popularCurrencies.slice(0, 4).map((currency) => (
            <a className="currency-card" href={`/poe2/currencies/${currency.id}`} key={currency.id}>
              <strong>{currency.name}</strong>
              <span>{currency.summary}</span>
            </a>
          ))}
        </div>
      </section>
    </main>
  );
}
