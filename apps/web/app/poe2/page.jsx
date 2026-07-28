import MarketDashboard from "../../components/MarketDashboard.jsx";
import { siteUrl } from "../../lib/market.js";

export const metadata = {
  title: "PoE2 currency market",
  description:
    "Live-style Path of Exile 2 currency dashboard using official completed-hour market data and manual current prices.",
  alternates: { canonical: `${siteUrl}/poe2` },
};

export default function Poe2Page() {
  return (
    <main className="radar-page">
      <MarketDashboard initialGame="poe2" />
    </main>
  );
}
