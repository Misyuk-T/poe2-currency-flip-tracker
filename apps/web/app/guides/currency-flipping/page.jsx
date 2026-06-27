import GuideLayout from "../../../components/GuideLayout.jsx";

export const metadata = {
  title: "PoE2 Currency Flipping Guide",
  description:
    "A practical Path of Exile 2 currency flipping guide focused on hourly market ranges, manual price checks and realistic risk.",
};

export default function CurrencyFlippingGuidePage() {
  return (
    <main>
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <a href="/">Home</a>
        <span aria-hidden="true">/</span>
        <a href="/guides">Guides</a>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Currency flipping</span>
      </nav>
      <GuideLayout slug="currency-flipping">
      <article className="content-section prose">
        <p className="eyebrow">Guide</p>
        <h1>PoE2 currency flipping without pretending prices are live</h1>
        <p>
          Raw prices are easy to find. The useful question is whether a market is moving enough, liquid enough and stable
          enough for the time you want to hold it.
        </p>
        <h2>1. Use hourly data as context</h2>
        <p>
          The official hourly feed is delayed, but it is useful for spotting markets with consistent movement, volume and
          range. Treat it as context, not as the price you can execute right now.
        </p>
        <h2>2. Verify the current price manually</h2>
        <p>
          Before buying, check the in-game market and enter the price you can actually get. The tracker uses that as the
          Working price and rebases recent hourly ranges around it.
        </p>
        <h2>3. Pick a horizon</h2>
        <p>
          A quick 1h flip and an overnight 8–10h order are different trades. Historical hit rate tells you how often
          comparable past windows reached the planned exit level.
        </p>
      </article>
      </GuideLayout>
    </main>
  );
}
