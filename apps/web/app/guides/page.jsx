import { siteUrl } from "../../lib/market.js";
import { guides } from "../../lib/guides.js";

export const metadata = {
  title: "PoE2 Currency Guides",
  description:
    "Practical Path of Exile 2 currency guides: flipping with hourly data, the Divine to Exalted ratio, and how the currency exchange works.",
  alternates: { canonical: `${siteUrl}/guides` },
};

export default function GuidesIndexPage() {
  const itemListLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: guides.map((g, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: g.title,
      url: `${siteUrl}/guides/${g.slug}`,
    })),
  };

  return (
    <main>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListLd) }} />
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <a href="/">Home</a>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Guides</span>
      </nav>
      <section className="page-heading">
        <p className="eyebrow">Guides</p>
        <h1>PoE2 currency guides</h1>
        <p>Short, honest guides on reading the market and planning trades — no fabricated prices, no hype.</p>
      </section>
      <div className="currency-grid">
        {guides.map((g) => (
          <a className="currency-card" href={`/guides/${g.slug}`} key={g.slug}>
            <strong>{g.title}</strong>
            <small>{g.blurb}</small>
          </a>
        ))}
      </div>
    </main>
  );
}
