import { guides } from "../lib/guides.js";

// Two-column guide shell: the article (dark prose panel) + a sticky sidebar with
// links into the product and the other guides. Fills the formerly-sparse guide
// pages with useful internal links instead of empty space.
export default function GuideLayout({ slug, children }) {
  const related = guides.filter((g) => g.slug !== slug);
  return (
    <div className="guide-layout">
      <div className="guide-main">{children}</div>
      <aside className="guide-rail" aria-label="Guide sidebar">
        <div className="guide-rail-card">
          <p className="eyebrow">Jump to the data</p>
          <a className="guide-rail-link" href="/poe2">Market radar →</a>
          <a className="guide-rail-link" href="/poe2/currencies">Currency prices →</a>
        </div>
        {related.length ? (
          <div className="guide-rail-card">
            <p className="eyebrow">More guides</p>
            <ul className="guide-rail-list">
              {related.map((g) => (
                <li key={g.slug}>
                  <a href={`/guides/${g.slug}`}>{g.title}</a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <p className="guide-rail-note">
          Prices across the site are completed-hour ranges, with the active source labelled in the radar — context to
          plan around, not live executable quotes.
        </p>
      </aside>
    </div>
  );
}
