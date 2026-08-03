/**
 * Pick a stable league-native quote currency from recent priced markets.
 *
 * `pairCount` is the important signal: the currency connected to the most
 * distinct traded pairs is the exchange's actual hub for that league. Keeping
 * the configured core anchors beside it preserves cross-currency conversions,
 * while the primary can change automatically for modes such as Ruthless.
 */
export function selectAutomaticAnchors(
  candidates = [],
  { fallbackAnchors = [], previousAnchor = null, maxAnchors = 4, hysteresisRatio = 0.8 } = {},
) {
  const byCurrency = new Map();
  for (const candidate of candidates) {
    const currency = candidate?.currency;
    const pairCount = Number(candidate?.pairCount);
    const sampleCount = Number(candidate?.sampleCount);
    if (typeof currency !== "string" || !currency || !(pairCount > 0)) continue;
    const current = byCurrency.get(currency) ?? { currency, pairCount: 0, sampleCount: 0 };
    current.pairCount += pairCount;
    current.sampleCount += Number.isFinite(sampleCount) && sampleCount > 0 ? sampleCount : 0;
    byCurrency.set(currency, current);
  }

  const ranked = [...byCurrency.values()].sort(
    (a, b) => b.pairCount - a.pairCount
      || b.sampleCount - a.sampleCount
      || a.currency.localeCompare(b.currency),
  );
  const strongest = ranked[0] ?? null;
  const previous = previousAnchor ? byCurrency.get(previousAnchor) : null;
  const primary = previous && strongest && previous.pairCount >= strongest.pairCount * hysteresisRatio
    ? previous.currency
    : strongest?.currency ?? fallbackAnchors[0] ?? null;

  const anchors = [...new Set([primary, ...fallbackAnchors].filter(Boolean))]
    .slice(0, Math.max(1, maxAnchors));
  return {
    primary,
    anchors,
    candidates: ranked,
  };
}
