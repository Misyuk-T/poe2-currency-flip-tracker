const CORE_UNITS = new Set(["exalted", "chaos", "divine"]);
const positive = (value) => Number.isFinite(value) && value > 0;

/** Rates expressed in one shared fallback-anchor basis, learned as a graph. */
export function unitRates(rows, fallbackAnchor = "exalted") {
  const rates = { exalted: null, chaos: null, divine: null, [fallbackAnchor]: 1 };
  for (let pass = 0; pass < 4; pass += 1) {
    for (const row of rows ?? []) {
      if (!CORE_UNITS.has(row?.target) || !positive(row.reference) || !row.anchor) continue;
      if (positive(rates[row.anchor])) rates[row.target] = row.reference * rates[row.anchor];
      else if (positive(rates[row.target])) rates[row.anchor] = rates[row.target] / row.reference;
    }
  }
  return rates;
}
