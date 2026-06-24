import "./globals.css";

export const metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: {
    default: "PoE2 Currency Flip Tracker",
    template: "%s · PoE2 Currency Flip Tracker",
  },
  description:
    "Path of Exile 2 currency market radar using official completed-hour data and user-entered current prices.",
  openGraph: {
    title: "PoE2 Currency Flip Tracker",
    description:
      "Find moving PoE2 currency markets, verify your current price, and plan conservative entry and exit levels.",
    type: "website",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <div className="app-shell">
          <header className="site-header">
            <a className="brand" href="/">
              <span className="brand-mark">⌁</span>
              <span>PoE2 Flip Tracker</span>
            </a>
            <nav aria-label="Main navigation">
              <a href="/poe2">Market radar</a>
              <a href="/poe2/currencies">Currencies</a>
              <a href="/guides/currency-flipping">Guide</a>
            </nav>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
