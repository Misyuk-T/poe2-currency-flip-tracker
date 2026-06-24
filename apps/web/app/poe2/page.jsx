import MarketDashboard from "../../components/MarketDashboard.jsx";

export const metadata = {
  title: "PoE2 Market Radar",
  description:
    "Live-style Path of Exile 2 currency dashboard using official completed-hour market data and manual current prices.",
};

export default function Poe2Page() {
  return (
    <main>
      <section className="page-heading">
        <p className="eyebrow">Official hourly market digest</p>
        <h1>PoE2 market radar</h1>
        <p>
          Discover moving currency markets, then open a trade plan and enter the current price you see in game.
        </p>
      </section>
      <MarketDashboard />
    </main>
  );
}
