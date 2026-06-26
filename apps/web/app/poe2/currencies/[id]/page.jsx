import { currencyName, iconUrl, popularCurrencies, siteUrl, formatNumber, formatPercent, displayDigits } from "../../../../lib/market.js";
import { contentFor } from "../../../../lib/currency-content.js";

// Incremental Static Regeneration: prerender popular currencies, refresh hourly
// so each page is crawlable static HTML that still tracks the latest stored hour.
export const revalidate = 3600;

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

function priceLine(summary) {
  if (!Number.isFinite(summary?.reference)) return null;
  return `${formatNumber(summary.reference, { maximumFractionDigits: displayDigits(summary.reference) })} ${summary.anchor}`;
}

export default async function CurrencyPage({ params }) {
  const { id } = await params;
  const name = currencyName(id);
  const content = contentFor(id);

  // Best-effort: a DB/build hiccup must not fail the page — fall back to static.
  // Imported dynamically so the DB/driver module stays out of Next's page-config
  // collection pass (which evaluates the module graph in a VM context).
  let summary = null;
  try {
    const { getCurrencySummary } = await import("../../../../lib/currency-summary.js");
    summary = await getCurrencySummary(id);
  } catch {
    summary = null;
  }
  const price = priceLine(summary);
  const anchorName = summary?.anchor ? currencyName(summary.anchor) : null;

  // Hand-written, currency-specific entries, plus a methodology FAQ only when we
  // actually show a price. The wording is mode-aware (sample vs live) and never
  // claims data we lack — so a no-data or anchor-currency page omits it entirely.
  const faqs = [...(content?.faq ?? [])];
  if (summary) {
    faqs.push({
      q: `How is the ${name} price on this page worked out?`,
      a: `It is the midpoint of the latest completed-hour low/high range${
        anchorName ? `, measured against ${anchorName}` : ""
      }, refreshed roughly hourly — a labelled proxy, not a live executable quote${
        summary.sourceMode === "fixture"
          ? ". The values shown are clearly-labelled sample data until the live feed is enabled"
          : ""
      }.`,
    });
  }

  const webPageLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: `${name} PoE2 market tracker`,
    description: price
      ? `${name} latest completed-hour midpoint ≈ ${price} in Path of Exile 2 (${summary.anchor} market)${
          summary.sourceMode === "fixture" ? " — sample data" : ""
        }.`
      : `Hourly market context and trade planning page for ${name} in Path of Exile 2.`,
    url: `${siteUrl}/poe2/currencies/${id}`,
  };

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${siteUrl}/` },
      { "@type": "ListItem", position: 2, name: "PoE2 currencies", item: `${siteUrl}/poe2/currencies` },
      { "@type": "ListItem", position: 3, name, item: `${siteUrl}/poe2/currencies/${id}` },
    ],
  };

  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return (
    <main>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(webPageLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />
      {faqs.length ? (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }} />
      ) : null}

      <nav className="breadcrumb" aria-label="Breadcrumb">
        <a href="/">Home</a>
        <span aria-hidden="true">/</span>
        <a href="/poe2/currencies">Currencies</a>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{name}</span>
      </nav>

      <section className="currency-hero">
        <img src={iconUrl(id)} alt="" />
        <div>
          <p className="eyebrow">PoE2 currency market</p>
          <h1>{name}</h1>
          <p>
            Use the market radar to compare the latest completed-hour range with the current price you see in game.
          </p>
          <a className="button primary" href={`/poe2?currency=${encodeURIComponent(id)}`}>Open in radar</a>
        </div>
      </section>

      {summary ? (
        <section className="content-section" aria-label="Latest hourly market">
          <div className="section-heading">
            <p className="eyebrow">
              Latest completed hour
              {summary.sourceMode === "fixture" ? " · sample data" : ""}
            </p>
            <h2>{name} market snapshot</h2>
          </div>
          <div className="currency-grid">
            <div className="currency-card">
              <strong>Midpoint (range-midpoint proxy)</strong>
              <span>≈ {price}</span>
            </div>
            <div className="currency-card">
              <strong>Hourly range</strong>
              <span>
                {Number.isFinite(summary.low) && Number.isFinite(summary.high)
                  ? `${formatNumber(summary.low, { maximumFractionDigits: displayDigits(summary.low) })} – ${formatNumber(summary.high, { maximumFractionDigits: displayDigits(summary.high) })} ${summary.anchor}`
                  : "—"}
              </span>
            </div>
            <div className="currency-card">
              <strong>24h movement</strong>
              <span>{Number.isFinite(summary.movement?.h24) ? formatPercent(summary.movement.h24) : "—"}</span>
            </div>
            <div className="currency-card">
              <strong>Samples (last 24h)</strong>
              <span>{summary.samples ?? 0}</span>
            </div>
          </div>
          <p className="hero-copy">
            {summary.latestCompletedHour ? `As of completed hour ${summary.latestCompletedHour}. ` : ""}
            The midpoint is a labelled proxy of the official low/high range, not an executable quote
            {summary.sourceMode === "fixture" ? "; values shown here are clearly-labelled sample data until the live feed is enabled." : "."}
          </p>
        </section>
      ) : null}

      {summary?.backtest && summary.backtest.evaluated >= 5 ? (
        <section className="content-section" aria-label={`${name} paper-trade backtest`}>
          <div className="section-heading">
            <p className="eyebrow">
              Simulated paper-trade backtest · {summary.backtestHorizonHours}h horizon
              {summary.sourceMode === "fixture" ? " · sample data" : ""}
            </p>
            <h2>Would these flips have paid?</h2>
          </div>
          <div className="currency-grid">
            <div className="currency-card">
              <strong>Trades evaluated</strong>
              <span>{summary.backtest.evaluated}</span>
            </div>
            <div className="currency-card">
              <strong>Fill rate</strong>
              <span>{Number.isFinite(summary.backtest.fillRate) ? formatPercent(summary.backtest.fillRate, { signed: false }) : "—"}</span>
            </div>
            <div className="currency-card">
              <strong>Take-profit hit rate</strong>
              <span>{Number.isFinite(summary.backtest.tpHitRate) ? formatPercent(summary.backtest.tpHitRate, { signed: false }) : "—"}</span>
            </div>
            <div className="currency-card">
              <strong>Avg result / filled trade</strong>
              <span className={(summary.backtest.avgProfitPct ?? 0) >= 0 ? "up" : "down"}>
                {Number.isFinite(summary.backtest.avgProfitPct) ? formatPercent(summary.backtest.avgProfitPct) : "—"}
              </span>
            </div>
            <div className="currency-card">
              <strong>Avg worst drawdown</strong>
              <span>{Number.isFinite(summary.backtest.avgMaeFactor) ? formatPercent(summary.backtest.avgMaeFactor) : "—"}</span>
            </div>
          </div>
          <p className="hero-copy">
            A simulation, not advice or a promise of profit: at each past completed hour it assumes the tool&apos;s
            median entry/exit envelope and checks the actual next {summary.backtestHorizonHours} hours. Fill rate is
            over resolved setups; the take-profit hit rate and average result are over the {summary.backtest.taken}{" "}
            filled trades. {summary.backtest.pending > 0 ? `${summary.backtest.pending} recent setup${summary.backtest.pending === 1 ? " is" : "s are"} still resolving and excluded. ` : ""}
            {summary.sourceMode === "fixture"
              ? "The underlying prices are clearly-labelled sample data until the live feed is enabled."
              : ""}
          </p>
        </section>
      ) : null}

      {content ? (
        <section className="content-section prose" aria-label={`About ${name}`}>
          <h2>What is the {name}?</h2>
          <p>{content.uses}</p>
          <h2>How it trades</h2>
          <p>{content.trading}</p>
        </section>
      ) : null}

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

      {faqs.length ? (
        <section className="content-section prose" aria-label={`${name} FAQ`}>
          <h2>{name} FAQ</h2>
          <dl className="faq">
            {faqs.map((f) => (
              <div className="faq-item" key={f.q}>
                <dt>{f.q}</dt>
                <dd>{f.a}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
    </main>
  );
}
