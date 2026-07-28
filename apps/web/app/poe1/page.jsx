import MarketDashboard from "../../components/MarketDashboard.jsx";
import { siteUrl } from "../../lib/market.js";

export const metadata = {
  title: "PoE currency market",
  description:
    "Path of Exile currency dashboard using official completed-hour Currency Exchange data.",
  alternates: { canonical: `${siteUrl}/poe1` },
};

export default function Poe1Page() {
  return (
    <main className="radar-page">
      <MarketDashboard initialGame="poe1" />
    </main>
  );
}
