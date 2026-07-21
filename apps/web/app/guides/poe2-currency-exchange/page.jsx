import { siteUrl } from "../../../lib/market.js";
import GuideLayout from "../../../components/GuideLayout.jsx";

export const metadata = {
  title: "PoE2 Currency Exchange, Explained",
  description:
    "How the Path of Exile 2 currency exchange works: pricing against an anchor, what liquidity and spread mean, and how to use official hourly data honestly.",
  alternates: { canonical: `${siteUrl}/guides/poe2-currency-exchange` },
};

const faqs = [
  {
    q: "What is the currency exchange in PoE2?",
    a: "It is how players swap one currency for another in bulk. Because everything trades against everything, prices are usually expressed against a common anchor — in practice the Exalted Orb — so a single ratio tells you what something costs.",
  },
  {
    q: "Why is everything priced in Exalted Orbs?",
    a: "Exalted is the most liquid, everyday currency, which makes it a convenient yardstick. Quoting prices in Exalted keeps them easy to compare and act on, the same way a market quotes everything in one base currency.",
  },
  {
    q: "Are the prices on this site the price I will pay?",
    a: "No. They are official completed-hour ranges from GGG's public Currency Exchange API, useful as context. Always confirm the live price in game before trading — thin markets in particular can move between the last completed hour and now.",
  },
];

export default function CurrencyExchangeGuide() {
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${siteUrl}/` },
      { "@type": "ListItem", position: 2, name: "Guides", item: `${siteUrl}/guides` },
      { "@type": "ListItem", position: 3, name: "PoE2 currency exchange", item: `${siteUrl}/guides/poe2-currency-exchange` },
    ],
  };
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };

  return (
    <main>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }} />
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <a href="/">Home</a>
        <span aria-hidden="true">/</span>
        <a href="/guides">Guides</a>
        <span aria-hidden="true">/</span>
        <span aria-current="page">PoE2 currency exchange</span>
      </nav>

      <GuideLayout slug="poe2-currency-exchange">
      <article className="content-section prose">
        <p className="eyebrow">Guide</p>
        <h1>PoE2 currency exchange, explained</h1>
        <p>
          Path of Exile 2 has dozens of currencies that trade against one another. Rather than memorise every pair, it
          helps to think of one anchor — the <a href="/poe2/currencies/exalted">Exalted Orb</a> — and read every other
          currency as a ratio against it.
        </p>

        <h2>Pricing against an anchor</h2>
        <p>
          Because Exalted is in constant demand and trades in small amounts, players use it as the unit of account. A
          price like &quot;0.5 Exalted&quot; or &quot;150 Exalted&quot; is just that currency&apos;s ratio to the anchor.
          The high-value <a href="/poe2/currencies/divine">Divine Orb</a> is the exception people quote big trades in —
          see the <a href="/guides/divine-to-exalted-ratio">Divine to Exalted ratio</a> guide.
        </p>

        <h2>Liquidity and spread</h2>
        <p>
          A deep, actively-traded market fills quickly and the gap between buy and sell prices is usually small. A thin
          market has fewer listings and a wider gap, so a stale quote costs you more. That is why the tracker surfaces
          how many samples a market had and how fresh its latest reading is.
        </p>

        <h2>Official hourly data vs the live price</h2>
        <p>
          The official feed publishes completed-hour low/high ranges. They are great for spotting which markets are
          moving, but they are delayed — they are not the price you can execute right now. The tracker treats them as
          historical context and asks you to enter the live price you actually see.
        </p>

        <h2>A simple workflow</h2>
        <ul>
          <li>Open the <a href="/poe2">market radar</a> to find currencies that are actually moving.</li>
          <li>Open the <a href="/poe2/currencies">currency index</a> and pick that market to read its latest hourly range and 24h move.</li>
          <li>Check the live in-game price and enter it as your working price.</li>
          <li>Plan a conservative entry and exit for the holding window you want.</li>
        </ul>

        <h2>FAQ</h2>
        <dl className="faq">
          {faqs.map((f) => (
            <div className="faq-item" key={f.q}>
              <dt>{f.q}</dt>
              <dd>{f.a}</dd>
            </div>
          ))}
        </dl>
      </article>
      </GuideLayout>
    </main>
  );
}
