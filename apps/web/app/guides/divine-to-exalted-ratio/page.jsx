import { siteUrl } from "../../../lib/market.js";

export const metadata = {
  title: "Divine to Exalted Ratio in PoE2 — How to Read It",
  description:
    "What the Divine to Exalted ratio means in Path of Exile 2, why it moves, and how to read the latest hourly Divine price in Exalted before pricing a trade.",
  alternates: { canonical: `${siteUrl}/guides/divine-to-exalted-ratio` },
};

const faqs = [
  {
    q: "How many Exalted Orbs is a Divine Orb in PoE2?",
    a: "It floats with supply and demand, so there is no fixed number. Check the latest completed-hour Divine price measured in Exalted on the Divine Orb page, then verify the live price in game before trading.",
  },
  {
    q: "Why does the Divine to Exalted ratio keep changing?",
    a: "Divine Orbs enter the economy from drops and leave it through endgame crafting, while Exalted demand comes from everyday crafting. When high-end crafting picks up, Divine demand rises and the ratio tends to climb; early in a league it usually sits lower.",
  },
  {
    q: "Is the ratio shown on this site a live price?",
    a: "No. The figures here are official completed-hour ranges, currently shown as clearly-labelled sample data until the live feed is enabled. Treat them as context and confirm the executable price in game.",
  },
];

export default function DivineToExaltedRatioGuide() {
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${siteUrl}/` },
      { "@type": "ListItem", position: 2, name: "Guides", item: `${siteUrl}/guides` },
      { "@type": "ListItem", position: 3, name: "Divine to Exalted ratio", item: `${siteUrl}/guides/divine-to-exalted-ratio` },
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
        <span aria-current="page">Divine to Exalted ratio</span>
      </nav>

      <article className="content-section prose">
        <p className="eyebrow">Guide</p>
        <h1>The Divine to Exalted ratio in PoE2</h1>
        <p>
          The Divine to Exalted ratio is simply how many{" "}
          <a href="/poe2/currencies/exalted">Exalted Orbs</a> one{" "}
          <a href="/poe2/currencies/divine">Divine Orb</a> is worth. It is the backbone of high-value pricing: big-ticket
          items are usually quoted in Divine, everyday items in Exalted, so converting between them needs this one number.
        </p>

        <h2>What the ratio actually is</h2>
        <p>
          In Path of Exile 2 the Exalted Orb behaves like the market&apos;s unit of account — most prices are quoted in
          Exalted. The Divine Orb sits at the top of the stack as a high-denomination store of value. The ratio
          (Exalted per Divine) is what lets you move between &quot;bulk&quot; pricing and big-trade pricing.
        </p>

        <h2>Why it moves</h2>
        <p>
          Divine Orbs enter the economy from drops and leave it through endgame crafting (a Divine rerolls the numeric
          values of an item&apos;s modifiers). Exalted demand comes from the everyday action of adding modifiers. When
          high-end crafting heats up, Divine demand tends to rise and the ratio climbs; early in a league it usually sits
          lower and drifts as the meta settles.
        </p>

        <h2>How to read it here</h2>
        <p>
          The <a href="/poe2/currencies/divine">Divine Orb page</a> shows the latest completed-hour Divine price measured
          in Exalted — a labelled midpoint of the official low/high range, not a live quote — plus the 24h move. The{" "}
          <a href="/poe2">market radar</a> shows whether the market is actually moving. Everything is currently
          sample data, clearly labelled, until the live feed is enabled.
        </p>

        <h2>Using it before a trade</h2>
        <p>
          Read the latest hourly Divine-to-Exalted figure for context, then verify the price you can actually get in
          game and enter it as your working price. The delayed hourly figure is a sanity check, not an executable
          quote — see the <a href="/guides/currency-flipping">currency flipping guide</a> for the full workflow.
        </p>

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
    </main>
  );
}
