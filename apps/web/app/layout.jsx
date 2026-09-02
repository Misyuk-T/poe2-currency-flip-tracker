import { Analytics } from "@vercel/analytics/next";

import "./globals.css";

export const metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: {
    default: "Exile Radar — PoE & PoE2 currency market",
    // Brand first, keyword second: "Exile Radar" is the name, but "PoE"/"PoE2"
    // still has to appear in the title for search.
    template: "%s · Exile Radar",
  },
  description:
    "Path of Exile and Path of Exile 2 currency market radar using official completed-hour data.",
  openGraph: {
    title: "Exile Radar — PoE & PoE2 currency market",
    description:
      "Track key currency rates and moving markets across Path of Exile and Path of Exile 2.",
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
              <span className="brand-mark" aria-hidden="true">
                {/* Radar scope: two rings, a sweep, and one blip. Inherits
                    currentColor from .brand-mark, so no fills here. */}
                <svg viewBox="0 0 32 32" focusable="false">
                  <path d="M26 16a10 10 0 1 1-20 0 10 10 0 1 1 20 0Z" />
                  <path d="M21 16a5 5 0 1 1-10 0 5 5 0 1 1 10 0Z" />
                  <path d="M16 16 23 9" />
                  <path d="M24.1 13.3a1.4 1.4 0 1 1-2.8 0 1.4 1.4 0 1 1 2.8 0Z" />
                </svg>
              </span>
              <span>Exile Radar</span>
            </a>
          </header>
          {children}
          <footer className="site-footer">
            {/* Exact wording required of third-party applications by GGG's
                developer documentation — do not paraphrase. */}
            <p>This product isn&apos;t affiliated with or endorsed by Grinding Gear Games in any way.</p>
            <p className="site-footer-sub">
              Market data from the official Path of Exile Currency Exchange API. Item names and artwork are
              © Grinding Gear Games.
            </p>
          </footer>
        </div>
        <Analytics />
      </body>
    </html>
  );
}
