/**
 * Parse and normalize raw GGG `trade2/exchange` offers into book levels.
 *
 * Observed contract (2026-06-19, undocumented endpoint — may change):
 *   - response `result` is an OBJECT keyed by listing id, not an array;
 *   - offers are embedded in each listing (no separate `/fetch` call);
 *   - for a request have=A want=B, each offer reads:
 *       offer.exchange = { currency: A, amount: <A per bundle> }
 *       offer.item     = { currency: B, amount: <B per bundle>, stock: <B available> }
 *
 * Everything is normalized to ONE convention regardless of request direction:
 *   price = ANCHOR units per 1 TARGET unit  (anchor-per-target).
 *
 * `side`:
 *   - "entry": request have=anchor want=target. We spend anchor to receive target.
 *   - "exit":  request have=target want=anchor. We spend target to receive anchor.
 *
 * @typedef {Object} BookLevel
 * @property {"entry"|"exit"} side
 * @property {string} listingId
 * @property {string|null} account
 * @property {string|null} indexed     ISO timestamp of the listing.
 * @property {number} price            Anchor units per 1 target unit.
 * @property {number} bundleTarget     Target units per indivisible bundle (integer-safe step).
 * @property {number} availableTarget  Max target units fillable from stock (bundle-aligned).
 */

/**
 * Normalize a full `result` object into deduplicated book levels.
 *
 * @param {Record<string, any>|undefined|null} resultObject  payload.result
 * @param {{ side: "entry"|"exit", anchorId: string, targetId: string }} ctx
 * @returns {BookLevel[]}
 */
export function normalizeResult(resultObject, ctx) {
  const listings = Object.values(resultObject ?? {});
  const levels = [];
  const seenListingIds = new Set();

  for (const listing of listings) {
    const listingId = listing?.id ?? listing?.listing?.id;
    if (!listingId || seenListingIds.has(listingId)) continue; // dedupe by listing id
    seenListingIds.add(listingId);

    const inner = listing.listing ?? {};
    const account = inner.account?.name ?? null;
    const indexed = inner.indexed ?? null;
    const offers = inner.offers ?? [];

    for (const offer of offers) {
      const level = normalizeOffer(offer, { ...ctx, listingId, account, indexed });
      if (level) levels.push(level);
    }
  }

  return levels;
}

/**
 * Normalize a single raw offer. Returns null if the offer is malformed or does
 * not match the requested direction.
 *
 * @param {any} offer
 * @param {{ side: "entry"|"exit", anchorId: string, targetId: string, listingId: string, account: string|null, indexed: string|null }} ctx
 * @returns {BookLevel|null}
 */
export function normalizeOffer(offer, ctx) {
  const { side, anchorId, targetId, listingId, account, indexed } = ctx;
  const exchange = offer?.exchange;
  const item = offer?.item;
  if (!exchange || !item) return null;

  const exCurrency = exchange.currency;
  const itemCurrency = item.currency;
  const exAmount = Number(exchange.amount);
  const itemAmount = Number(item.amount);
  const itemStock = Number(item.stock ?? 0);

  // Reject malformed / non-positive amounts.
  if (!isPositive(exAmount) || !isPositive(itemAmount)) return null;

  let price;
  let bundleTarget;
  let stockTarget;

  if (side === "entry") {
    // have=anchor want=target: exchange=anchor, item=target.
    if (exCurrency !== anchorId || itemCurrency !== targetId) return null; // wrong direction
    price = exAmount / itemAmount; // anchor per target
    bundleTarget = itemAmount; // target units per bundle
    // stock is in target units; fillable target is stock floored to whole bundles.
    stockTarget = itemStock;
  } else if (side === "exit") {
    // have=target want=anchor: exchange=target, item=anchor.
    if (exCurrency !== targetId || itemCurrency !== anchorId) return null; // wrong direction
    price = itemAmount / exAmount; // anchor per target (invert)
    bundleTarget = exAmount; // target units per bundle (what we hand over)
    // stock is in anchor units; how many bundles can be paid out = floor(stockAnchor / anchorPerBundle).
    const maxBundles = Math.floor(itemStock / itemAmount);
    stockTarget = maxBundles * exAmount;
  } else {
    throw new Error(`Unknown side: ${side}`);
  }

  const maxBundles = Math.floor(stockTarget / bundleTarget);
  const availableTarget = maxBundles * bundleTarget;
  if (!(availableTarget > 0) || !Number.isFinite(price) || price <= 0) return null;

  return { side, listingId, account, indexed, price, bundleTarget, availableTarget };
}

function isPositive(n) {
  return Number.isFinite(n) && n > 0;
}
