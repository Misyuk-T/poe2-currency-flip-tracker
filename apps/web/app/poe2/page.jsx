import MarketDashboard from "../../components/MarketDashboard.jsx";

export const metadata = {
  title: "PoE2 Market Radar",
  description:
    "Live-style Path of Exile 2 currency dashboard using official completed-hour market data and manual current prices.",
};

export default function Poe2Page() {
  return (
    <main className="radar-page">
      <MarketDashboard />
    </main>
  );
}
