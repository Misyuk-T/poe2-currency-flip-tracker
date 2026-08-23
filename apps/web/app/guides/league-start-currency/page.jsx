import { siteUrl } from "../../../lib/market.js";
import GuideLayout from "../../../components/GuideLayout.jsx";

// Evergreen slug on purpose: no league name and no patch version in the URL or
// the title, so this page keeps accumulating authority across 0.5.5, 1.0 and
// every league after. Anything league-specific lives in `currentLeague` below
// and in body copy, where it is a one-line refresh.
const currentLeague = { name: "Runes of Aldur", version: "0.5.0", startedOn: "29 May 2026" };

export const metadata = {
  title: "PoE2 League Start Currency Guide",
  description:
    "What actually moves the Path of Exile 2 currency market in the first days of a league, which categories of goods draw early demand, and how to read hourly prices while the data is still thin.",
  alternates: { canonical: `${siteUrl}/guides/league-start-currency` },
};

const faqs = [
  {
    q: "What currency should I buy at league start in PoE2?",
    a: "There is no single right answer, and anyone who names one is guessing. In mechanism terms, the currencies that are safest to hold early are the ones everybody produces and consumes — the everyday crafting orbs — because you can actually get out of them again. The riskiest are the ones carrying the biggest early scarcity premium, since that premium tends to erode as supply catches up. Decide from the liquidity and hourly range you can see, not from a prediction.",
  },
  {
    q: "Is league start a good time to flip currency in PoE2?",
    a: "League start is when prices move most, and that cuts both ways: wider swings mean more opportunity and a higher chance of being stuck holding something thin that nobody is buying yet. If you trade early, size positions against how liquid the market is rather than against how far it has moved.",
  },
  {
    q: "Why do PoE2 currency prices swing so much on day 1?",
    a: "Supply of everything starts at zero and arrives at different speeds, demand is concentrated on the same handful of progression items, and very few trades have happened. When a market has only a few trades in it, each one moves the quoted range a long way — so early prices are a market being discovered, not a settled market being nudged.",
  },
  {
    q: "When do PoE2 currency prices stabilise after a league launch?",
    a: "There is no fixed day. Prices generally steady as supply catches up with the front-loaded demand, which happens sooner for common bulk currencies and later for high-value endgame ones. Rather than waiting for a date, watch for the 24h move to shrink and the hourly low/high range to narrow on the markets you care about.",
  },
  {
    q: "Does this tracker have data on day 1 of a new league?",
    a: "It follows the official hourly currency exchange feed, so a new league is covered once it is published there and the tracker is pointed at it. Expect the first day to be thin: fewer samples per hour and wider low/high ranges. Treat those early readings as low-confidence context and confirm any price in game.",
  },
  {
    q: "Which league does this guide cover?",
    a: `It is written to apply to any Path of Exile 2 league start. The league running as this was last updated is ${currentLeague.name} (${currentLeague.version}), which launched on ${currentLeague.startedOn}; the mechanics described here are meant to carry over to whatever launches next.`,
  },
];

export default function LeagueStartCurrencyGuide() {
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${siteUrl}/` },
      { "@type": "ListItem", position: 2, name: "Guides", item: `${siteUrl}/guides` },
      { "@type": "ListItem", position: 3, name: "League start currency", item: `${siteUrl}/guides/league-start-currency` },
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
        <span aria-current="page">League start currency</span>
      </nav>

      <GuideLayout slug="league-start-currency">
      <article className="content-section prose">
        <p className="eyebrow">Guide</p>
        <h1>PoE2 league start currency guide</h1>
        <p>
          League start is the one moment when Path of Exile 2 currency prices are both the most volatile and the least
          well measured. Everyone begins from nothing, every market re-prices from scratch, and the hourly data that is
          dependable in week six barely exists in hour six. This guide covers what drives those first days, which
          categories of goods tend to draw the earliest demand, and how to read the{" "}
          <a href="/poe2">market radar</a> while the numbers are still thin — without pretending anyone can predict a
          price.
        </p>
        <p>
          It is written to be league-agnostic on purpose. At the time of writing the live league is{" "}
          {currentLeague.name} ({currentLeague.version}), launched {currentLeague.startedOn}, but nothing below depends
          on that: the same supply-and-demand mechanics show up at every launch.
        </p>

        <h2>Why league start moves the currency market most</h2>
        <p>
          A fresh league resets the economy to zero. There is no stock of anything, no established price for anything,
          and nobody has reached the content that produces the expensive drops yet. A handful of forces pull in
          different directions at once:
        </p>
        <ul>
          <li>
            <strong>Supply starts at zero and arrives unevenly.</strong> Early-campaign currency shows up within hours;
            anything gated behind endgame content does not exist until the first players get there.
          </li>
          <li>
            <strong>Demand is concentrated and front-loaded.</strong> Almost everyone wants the same few progression
            items in the same few hours — skill gems to slot, and a cheap way to make gear usable — so demand peaks
            long before supply does.
          </li>
          <li>
            <strong>The anchor itself is unsettled.</strong> Prices across this site are quoted against the{" "}
            <a href="/poe2/currencies/exalted">Exalted Orb</a>. Early on, the relationships between Exalted,{" "}
            <a href="/poe2/currencies/chaos">Chaos</a> and{" "}
            <a href="/poe2/currencies/divine">Divine</a> are still being discovered, so a ratio that looks wrong may
            just be a ratio that has not settled.
          </li>
          <li>
            <strong>Thin markets exaggerate everything.</strong> With few trades per hour, the published low/high range
            is wide and a single unusual trade drags it. Big early percentage moves are often a sample-size artefact
            rather than a real re-pricing.
          </li>
        </ul>

        <h2>What the first three days usually look like</h2>
        <p>
          Described as tendencies, not as a forecast — and with the caveat that every league differs:
        </p>
        <ul>
          <li>
            <strong>Day 1.</strong> Very little is trading in volume. Quoted prices come from a small number of trades,
            so ranges are wide and the same market can look very different two hours apart. This is the worst day of
            the league to trust any single reading.
          </li>
          <li>
            <strong>Day 2 to 3.</strong> The first real supply arrives as players clear content, and early scarcity
            premiums generally start to erode. Bulk crafting currencies usually find a workable price before
            high-value ones do, simply because far more of them exist.
          </li>
          <li>
            <strong>End of the first week.</strong> The ratios between the main currencies typically stop swinging as
            hard, and the hourly ranges narrow enough that comparing one hour to the last actually means something.
          </li>
        </ul>
        <p>
          Those patterns follow from supply and demand arriving at different speeds. They are not guarantees: a balance
          patch that changes drop rates, a new league mechanic, or one popular build can break any of them.
        </p>

        <h2>Categories that tend to move early</h2>
        <p>
          Think in categories rather than in individual items. The specific item that spikes changes from league to
          league; the mechanism that makes a category move does not.
        </p>

        <h3>Early progression consumables</h3>
        <p>
          Uncut gems and essences sit closest to the front-loaded demand. Every character needs skill and support gems
          in its first hours, and essences offer a deterministic way to force a usable modifier onto gear before anyone
          has accumulated real crafting currency. Demand is at its peak precisely when supply is smallest, and the gap
          tends to close as more players clear more content — which is exactly why a premium here is usually temporary.
        </p>

        <h3>Baseline crafting orbs</h3>
        <p>
          Transmutation, augmentation, alchemy and regal orbs, plus the <a href="/poe2/currencies/chaos">Chaos Orb</a>{" "}
          and <a href="/poe2/currencies/exalted">Exalted Orb</a>, are produced and consumed by everyone. They are
          generally the deepest markets on day 1 and the ones where an hourly reading is most likely to be meaningful.
          They are also the easiest to exit, which matters more at league start than any headline percentage move.
        </p>

        <h3>High-denomination stores of value</h3>
        <p>
          The <a href="/poe2/currencies/divine">Divine Orb</a> barely exists in the first day or two, because the
          content that produces it has not been reached at scale. The Divine-to-Exalted relationship is usually among
          the last things to settle — see the{" "}
          <a href="/guides/divine-to-exalted-ratio">Divine to Exalted ratio guide</a> for how to read it once it does.
          Tiered variants such as the <a href="/poe2/currencies/greater-exalted-orb">Greater Exalted Orb</a> behave the
          same way: higher unit value, thinner trading, more damage done by a stale quote.
        </p>

        <h3>League-mechanic and gambling goods</h3>
        <p>
          Goods that drop from a league mechanic — omens, breach, expedition and ritual materials — have supply gated
          on how quickly players reach that mechanic and how it was tuned in the patch. High-variance crafting items
          like the <a href="/poe2/currencies/vaal">Vaal Orb</a> sit nearby: demand tracks whatever crafting gamble the
          meta settles on. This is the category where the least is known at launch, for you and for the market alike.
        </p>

        <h3>Endgame access</h3>
        <p>
          Waystones and other endgame-access items only start trading once the first wave of players reaches maps, so
          both sides of that market appear later than the campaign-facing ones. Browse any of these in the{" "}
          <a href="/poe2/currencies">currency index</a> to see what its hourly data actually looks like rather than
          assuming.
        </p>

        <h2>How to use the radar in the first days</h2>
        <ul>
          <li>
            Open the <a href="/poe2">market radar</a> and sort by <strong>Liquidity</strong> before you sort by 24h
            movement. Early in a league, the biggest movers are usually the thinnest markets.
          </li>
          <li>
            Before acting on any market, open its page from the{" "}
            <a href="/poe2/currencies">currency index</a> and check the sample count for the last 24 hours and the
            timestamp of the latest completed hour. A large move built from a handful of samples is noise.
          </li>
          <li>
            Compare the width of the hourly low/high range against the move you think you have spotted. If the range is
            wider than the edge, there is no edge yet.
          </li>
          <li>
            Verify the live price in game and enter it as your working price. Everything published here is a
            completed-hour range — delayed context, never an executable quote.
          </li>
          <li>
            Pick a holding horizon you can actually watch, and prefer markets you can exit. The{" "}
            <a href="/guides/currency-flipping">currency flipping guide</a> covers that workflow, and{" "}
            <a href="/guides/poe2-currency-exchange">how the currency exchange works</a> covers liquidity and spread in
            more detail.
          </li>
          <li>
            Re-check the anchor after a couple of days. If Exalted itself has re-priced against everything else, ratios
            you noted on day 1 are not comparable to what you are looking at now.
          </li>
        </ul>

        <h2>A day-1 to day-3 checklist</h2>
        <ul>
          <li>Keep enough liquid currency to cover your own crafting before speculating with any of it.</li>
          <li>Favour markets with visible depth over markets with a big headline move.</li>
          <li>Re-read every price after a fresh completed hour rather than trusting one snapshot.</li>
          <li>Assume any early scarcity premium can disappear as supply arrives.</li>
          <li>Write down the ratio you entered at, so you can tell a real move from an anchor shift later.</li>
        </ul>

        <h2>What this guide deliberately does not do</h2>
        <p>
          It does not tell you that a particular currency will be worth a particular amount, or that buying X on day 1
          and selling on day 3 pays. Nobody knows that — not us, not anyone quoting confident numbers before a league
          exists. Past leagues are weak evidence for the next one, because balance patches change drop rates, crafting
          costs and what is farmable, and a new mechanic can create or destroy an entire category of goods overnight.
        </p>
        <p>
          What this site can honestly offer at league start is the official hourly exchange data as it arrives, clearly
          labelled with how fresh and how well-sampled it is, so you can judge for yourself when a price is worth
          acting on.
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
      </GuideLayout>
    </main>
  );
}
