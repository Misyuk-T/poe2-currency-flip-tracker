const CORE_UNITS = new Set(["exalted", "chaos", "divine"]);
const positive = (value) => Number.isFinite(value) && value > 0;

/** Rates expressed in one shared fallback-anchor basis, learned as a graph. */
export function unitRates(rows, fallbackAnchor = "exalted") {
  const nativeAnchors = [...new Set((rows ?? []).map((row) => row?.anchor).filter(Boolean))];
  // A merged "best" payload can contain no row in the requested anchor. In
  // sparse leagues, seeding that absent anchor as 1 silently relabels a native
  // Exalted/Divine price as Chaos. Prefer the requested basis only when it is
  // actually represented; otherwise keep the first real native basis honest.
  const basis = nativeAnchors.includes(fallbackAnchor)
    ? fallbackAnchor
    : nativeAnchors[0] ?? fallbackAnchor;
  const convertibleUnits = new Set([...CORE_UNITS, ...nativeAnchors]);
  const rates = Object.fromEntries([...convertibleUnits].map((unit) => [unit, null]));
  rates[basis] = 1;
  for (let pass = 0; pass < convertibleUnits.size + 1; pass += 1) {
    for (const row of rows ?? []) {
      if (!convertibleUnits.has(row?.target) || !positive(row.reference) || !row.anchor) continue;
      if (positive(rates[row.anchor])) rates[row.target] = row.reference * rates[row.anchor];
      else if (positive(rates[row.target])) rates[row.anchor] = rates[row.target] / row.reference;
    }
  }
  return rates;
}
