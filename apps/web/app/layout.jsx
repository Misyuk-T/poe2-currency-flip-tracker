import "./globals.css";

export const metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: {
    default: "PoE Currency Market Radar",
    template: "%s · PoE Currency Market Radar",
  },
  description:
    "Path of Exile and Path of Exile 2 currency market radar using official completed-hour data.",
  openGraph: {
    title: "PoE Currency Market Radar",
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
                <svg viewBox="0 0 32 32" focusable="false">
                  <path d="M16 7v18" />
                  <path d="M10 25h12" />
                  <path d="M8 11h16" />
                  <path d="M16 8l-6 3 6 3 6-3-6-3Z" />
                  <path d="M9 12 5.5 19h7L9 12Z" />
                  <path d="M23 12 19.5 19h7L23 12Z" />
                </svg>
              </span>
              <span>PoE Market Radar</span>
            </a>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
