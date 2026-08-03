import { quoteFromAnchor } from "./price-guidance.js";

/** Distance between the latest completed hour's low and high. */
export function rowSpread(row) {
  if (!Number.isFinite(row?.low) || !Number.isFinite(row?.high) || row.low <= 0 || row.high <= row.low) return null;
  return row.high / row.low - 1;
}

function displayedPrice(row, value, { displayCurrency = null, rates } = {}) {
  return quoteFromAnchor(value, {
    anchor: row?.anchor,
    displayCurrency,
    rates,
  }).value;
}

function sortValue(row, key, quoteOptions) {
  if (key === "profit100k") return row._profitPer100k;
  if (key === "activity") return row.activityScore;
  if (key === "spread") return rowSpread(row);
  if (key === "buy") return displayedPrice(row, row.low, quoteOptions);
  if (key === "sell") return displayedPrice(row, row.high, quoteOptions);
  if (key === "price") return displayedPrice(row, row.reference, quoteOptions);
  if (key === "movement") return row.movement?.h24;
  if (key === "liquidity") return row.volume;
  if (key === "name") return row.targetName ?? row.target ?? "";
  return row.activityScore;
}

/**
 * Compare rows using the same normalized quote displayed in the table.
 *
 * Radar rows can use different native anchors. Comparing their raw lows/highs
 * mixes units (for example Chaos with Divine), which makes a visually sorted
 * column jump between small and large numbers.
 */
export function compareMarketRows(a, b, sortToken, quoteOptions) {
  const [key, direction = "desc"] = sortToken.split(":");
  const av = sortValue(a, key, quoteOptions);
  const bv = sortValue(b, key, quoteOptions);
  const multiplier = direction === "asc" ? 1 : -1;
  if (typeof av === "string" || typeof bv === "string") {
    return String(av ?? "").localeCompare(String(bv ?? "")) * multiplier;
  }
  const aFinite = Number.isFinite(av);
  const bFinite = Number.isFinite(bv);
  if (!aFinite && !bFinite) return 0;
  if (!aFinite) return 1;
  if (!bFinite) return -1;
  return (av - bv) * multiplier;
}
