"use client";

import { currencyName, formatNumber, formatPercent } from "../lib/market.js";

function hour(value) {
  if (!Number.isFinite(value)) return "unknown time";
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function comparisonText(comparison) {
  if (comparison.state === "changed") return formatPercent(comparison.change);
  return comparison.message;
}

export default function SavedMarkets({ items, error, onOpen, onRemove }) {
  return (
    <section className="saved-markets" aria-labelledby="saved-markets-title">
      <div className="saved-markets-heading">
        <div>
          <p className="eyebrow">Your workspace</p>
          <h3 id="saved-markets-title">Saved markets</h3>
        </div>
        <span>{items.length}/30 saved</span>
      </div>
      <p className="saved-markets-help">Saved markets stay in this browser for this game and league. Changes compare completed hourly references from your previous tab visit.</p>
      {error && <p className="saved-markets-error" role="alert">{error}</p>}
      {!items.length ? (
        <p className="saved-markets-empty">Save a market from the table or its plan to compare it on a later visit.</p>
      ) : (
        <ul className="saved-markets-list">
          {items.map(({ saved, row, comparison }) => (
            <li key={`${saved.target}\u0000${saved.anchor}`}>
              <button
                type="button"
                className="saved-market-main"
                disabled={!row}
                onClick={() => row && onOpen(row.pairId)}
                aria-label={row ? `Open ${row.targetName ?? saved.target} market` : `${saved.target} market is unavailable`}
              >
                <strong>{row?.targetName ?? saved.target}</strong>
                <span>{currencyName(saved.anchor)} · {comparisonText(comparison)}</span>
                {comparison.previous && <small>Previous: {formatNumber(comparison.previous.reference)} · {hour(comparison.previous.completedHour)}</small>}
                {comparison.current && <small>Current: {formatNumber(comparison.current.reference)} · {hour(comparison.current.completedHour)}</small>}
              </button>
              <button type="button" className="saved-market-remove" onClick={() => onRemove(saved)} aria-label={`Remove ${row?.targetName ?? saved.target} from saved markets`}>Remove</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
