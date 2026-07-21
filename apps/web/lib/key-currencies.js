const CORE = [
  { id: "chaos", name: "Chaos Orb" },
  { id: "divine", name: "Divine Orb" },
  { id: "exalted", name: "Exalted Orb" },
];

const positive = (value) => Number.isFinite(value) && value > 0;

function movement(values) {
  if (values.length < 2 || !positive(values[0])) return null;
  return values[values.length - 1] / values[0] - 1;
}

function directCard(row, currency) {
  const values = (row?.sparkline24h ?? []).filter(positive);
  return {
    ...currency,
    value: positive(row?.reference) ? row.reference : null,
    unit: row?.anchor ?? "exalted",
    values,
    movement: Number.isFinite(row?.movement?.h24) ? row.movement.h24 : movement(values),
    available: Boolean(row && positive(row.reference)),
  };
}

/**
 * Three dashboard cards from the already-loaded radar payload. Non-anchor
 * currencies use their direct rates; the active anchor is inverted from a
 * traded core pair so its chart remains meaningful instead of a flat 1.0 line.
 */
export function keyCurrencyCards(rows = [], fallbackAnchor = "exalted") {
  const byTarget = new Map(rows.map((row) => [row.target, row]));
  const anchor = rows.find((row) => row.anchor)?.anchor ?? fallbackAnchor;
  const inverseOrder = anchor === "chaos" ? ["exalted", "divine"] : ["chaos", "divine"];
  const inverseSource = inverseOrder.map((id) => byTarget.get(id)).find(Boolean) ?? null;
  return CORE.map((currency) => {
    if (currency.id !== anchor) return directCard(byTarget.get(currency.id), currency);
    const inverseValues = (inverseSource?.sparkline24h ?? []).filter(positive).map((value) => 1 / value);
    const inverseValue = positive(inverseSource?.reference) ? 1 / inverseSource.reference : null;
    return {
      ...currency,
      value: inverseValue,
      unit: inverseSource?.target ?? (anchor === "chaos" ? "exalted" : "chaos"),
      values: inverseValues,
      movement: movement(inverseValues),
      available: positive(inverseValue),
    };
  });
}

/** Scale finite values into an SVG polyline without leaking chart concerns. */
export function sparklinePoints(values, width = 180, height = 54, padding = 3) {
  const clean = (values ?? []).filter(positive);
  if (clean.length < 2) return "";
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const span = max - min || Math.max(Math.abs(max) * 0.01, 1e-9);
  return clean
    .map((value, index) => {
      const x = padding + (index / (clean.length - 1)) * (width - padding * 2);
      const y = height - padding - ((value - min) / span) * (height - padding * 2);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}
