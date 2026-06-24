/**
 * Resolve the current Divine Orb price in Exalted Orbs from a radar snapshot.
 * The radar `reference` is always denominated in its selected anchor.
 */
export function divineInExalted(rows, anchor) {
  if (anchor === "exalted") {
    const divine = rows.find((row) => row.target === "divine");
    return positive(divine?.reference) ? divine.reference : null;
  }
  if (anchor === "divine") {
    const exalted = rows.find((row) => row.target === "exalted");
    return positive(exalted?.reference) ? 1 / exalted.reference : null;
  }
  return null;
}

/**
 * Display cheap markets in Exalted Orbs and markets worth at least one Divine
 * Orb in Divine Orbs. This changes presentation only; callers should keep
 * sorting and scoring with the original reference value.
 */
export function adaptiveMarketPrice(reference, { anchor, divineInExalted: rate }) {
  if (!positive(reference)) return { value: null, unit: null };
  if (!positive(rate) || !["exalted", "divine"].includes(anchor)) {
    return { value: reference, unit: anchor ?? null };
  }

  const exaltedValue = anchor === "exalted" ? reference : reference * rate;
  return exaltedValue >= rate
    ? { value: exaltedValue / rate, unit: "divine" }
    : { value: exaltedValue, unit: "exalted" };
}

function positive(value) {
  return Number.isFinite(value) && value > 0;
}
