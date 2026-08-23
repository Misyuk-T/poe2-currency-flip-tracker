import MarketDashboard from "../../components/MarketDashboard.jsx";
import { siteUrl } from "../../lib/market.js";

export const metadata = {
  title: "PoE2 currency market",
  description:
    "Path of Exile 2 currency dashboard with hourly prices from official completed-hour market data, plus planning around the price you verify in game.",
  alternates: { canonical: `${siteUrl}/poe2` },
};

export default function Poe2Page() {
  return (
    <main className="radar-page">
      <MarketDashboard initialGame="poe2" />
    </main>
  );
}
