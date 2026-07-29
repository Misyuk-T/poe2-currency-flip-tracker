"use client";

import { useMemo } from "react";
import { buildReachLadder } from "../lib/reach-curve.js";
import { displayDigits, formatNumber } from "../lib/market.js";

/**
 * Two mirrored empirical curves against a price axis.
 *
 * Left, green: how often the market came DOWN to a price. Right, red: having
 * come down to your buy, how often it went back UP to a price. Both read off
 * the same vertical axis, so the gap between a buy you can rely on and a sell
 * you can rely on is the vertical distance between two points you choose — not
 * a number we picked for you.
 *
 * Stepped, not smoothed. Each step is a count of windows; interpolating between
 * them would draw a density the data does not contain.
 */
const WIDTH = 560;
const HEIGHT = 420;
const PAD = { top: 18, bottom: 30, left: 14, right: 14 };
const LABEL_W = 84;

function priceLabel(value) {
  if (!Number.isFinite(value)) return "—";
  return formatNumber(value, { maximumFractionDigits: displayDigits(value) });
}

export default function ReachLadder({ points, horizonHours, basis, buyPrice, sellPrice, unit, loading = false }) {
  const ladder = useMemo(
    () => buildReachLadder(points, { horizonHours, basis, buyPrice, sellPrice }),
    [basis, buyPrice, horizonHours, points, sellPrice],
  );

  if (loading || !ladder) {
    return (
      <div className="reach-wrap">
        <div className="reach-empty" style={{ height: HEIGHT }}>
          {loading ? (
            <span className="rt-spinner" aria-label="Loading" />
          ) : (
            <p>Not enough completed hours yet to say how often a price was reached.</p>
          )}
        </div>
      </div>
    );
  }

  const { levels } = ladder;
  const plotTop = PAD.top;
  const plotBottom = HEIGHT - PAD.bottom;
  const centreLeft = WIDTH / 2 - LABEL_W / 2;
  const centreRight = WIDTH / 2 + LABEL_W / 2;
  const leftWidth = centreLeft - PAD.left;
  const rightWidth = WIDTH - PAD.right - centreRight;

  // Prices are ratios; place them on a log axis so the steps read evenly.
  const logMin = Math.log(levels[0].price);
  const logMax = Math.log(levels.at(-1).price);
  const y = (price) => plotBottom - ((Math.log(price) - logMin) / (logMax - logMin)) * (plotBottom - plotTop);
  const rowHeight = (plotBottom - plotTop) / levels.length;

  const marks = [
    { price: buyPrice, label: "Buy", className: "buy" },
    { price: basis, label: "Now", className: "now" },
    { price: sellPrice, label: "Sell", className: "sell" },
  ].filter((mark) => Number.isFinite(mark.price) && mark.price > 0);

  return (
    <div className="reach-wrap">
      <div className="reach-legend">
        <span className="reach-key buy">Came down to this price</span>
        <span className="reach-key sell">Then came back up to it</span>
      </div>
      <svg
        className="reach-svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`How often this market reached each price within ${horizonHours} hours, over ${ladder.windows} past windows`}
      >
        {[0.25, 0.5, 0.75, 1].map((share) => (
          <g key={share} className="reach-grid">
            <line x1={centreLeft - leftWidth * share} y1={plotTop} x2={centreLeft - leftWidth * share} y2={plotBottom} />
            <line x1={centreRight + rightWidth * share} y1={plotTop} x2={centreRight + rightWidth * share} y2={plotBottom} />
            <text className="reach-axis" x={centreLeft - leftWidth * share} y={HEIGHT - 12} textAnchor="middle">
              {Math.round(share * 100)}%
            </text>
            <text className="reach-axis" x={centreRight + rightWidth * share} y={HEIGHT - 12} textAnchor="middle">
              {Math.round(share * 100)}%
            </text>
          </g>
        ))}

        {levels.map((level) => {
          const top = y(level.price) - rowHeight / 2;
          const height = Math.max(1, rowHeight - 1);
          return (
            <g key={level.price}>
              {level.buyReach > 0 && (
                <rect
                  className="reach-bar buy"
                  x={centreLeft - leftWidth * level.buyReach}
                  y={top}
                  width={leftWidth * level.buyReach}
                  height={height}
                />
              )}
              {level.sellReach > 0 && (
                <rect className="reach-bar sell" x={centreRight} y={top} width={rightWidth * level.sellReach} height={height} />
              )}
            </g>
          );
        })}

        {marks.map((mark) => (
          <g key={mark.label} className={`reach-mark ${mark.className}`}>
            <line x1={PAD.left} y1={y(mark.price)} x2={WIDTH - PAD.right} y2={y(mark.price)} />
            <text x={centreLeft + LABEL_W / 2} y={y(mark.price) - 4} textAnchor="middle">
              {mark.label} {priceLabel(mark.price)}
            </text>
          </g>
        ))}
      </svg>

      <p className="reach-readout">
        {Number.isFinite(buyPrice) && (
          <>
            <strong>{Math.round((ladder.atPlan.buyReach ?? 0) * 100)}%</strong> of {ladder.windows} past {horizonHours}h windows
            came down to {priceLabel(buyPrice)}
            {unit ? ` ${unit}` : ""}
            {ladder.observable > 0 && Number.isFinite(sellPrice) ? (
              <>
                {" · of those, "}
                <strong>{Math.round((ladder.atPlan.sellReach ?? 0) * 100)}%</strong> went back up to{" "}
                {priceLabel(sellPrice)} in a later hour
              </>
            ) : null}
          </>
        )}
      </p>
    </div>
  );
}
