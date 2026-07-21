import MarketDashboard from "../../components/MarketDashboard.jsx";

export const metadata = {
  title: "PoE Market Radar",
  description:
    "Path of Exile currency dashboard using official completed-hour Currency Exchange data.",
};

export default function Poe1Page() {
  return (
    <main className="radar-page">
      <MarketDashboard initialGame="poe1" />
    </main>
  );
}
