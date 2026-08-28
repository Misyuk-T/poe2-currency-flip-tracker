const TAGS = /<[^>]*>/g;

export function decodeHtml(value = "") {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#([0-9]+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#0*39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function visibleText(value) {
  return decodeHtml(String(value ?? "").replace(TAGS, " ")).replace(/\s+/g, " ").trim();
}

export function normalizeExchangeName(value) {
  return decodeHtml(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[‘’‛`´]/g, "'")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function itemIdentity(item) {
  const href = String(item?.href ?? "").trim();
  const name = item?.normalizedName || normalizeExchangeName(item?.name);
  return href && name ? `${href}\u0000${name}` : null;
}

/**
 * PoE2DB may replace the metadata-bearing data-hover query with an opaque
 * cache URL. Keep a known metadata id only when both the player-facing name
 * and stable item href still identify the exact same snapshot row.
 */
export function preserveKnownMetadataIds(snapshot, previous) {
  if (!snapshot?.items?.length || !previous?.items?.length) return snapshot;

  const previousByIdentity = new Map();
  for (const item of previous.items) {
    if (!item?.metadataId) continue;
    const identity = itemIdentity(item);
    if (!identity) continue;
    previousByIdentity.set(identity, previousByIdentity.has(identity) ? null : item.metadataId);
  }

  return {
    ...snapshot,
    items: snapshot.items.map((item) => {
      if (item.metadataId) return item;
      const identity = itemIdentity(item);
      const metadataId = identity ? previousByIdentity.get(identity) : null;
      return metadataId ? { ...item, metadataId } : item;
    }),
  };
}

function attribute(attributes, name) {
  const match = String(attributes).match(new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)')`, "i"));
  return decodeHtml(match?.[1] ?? match?.[2] ?? "") || null;
}

function metadataIdFrom(attributes) {
  const hover = attribute(attributes, "data-hover");
  if (!hover) return null;
  let decoded = hover;
  try {
    decoded = decodeURIComponent(hover);
  } catch {
    // Keep the original attribute when a third-party page contains a malformed escape.
  }
  const match = decoded.match(/(?:^|[?&]s=)Data[\\/]+BaseItemTypes[\\/]+(Metadata[\\/]+Items[\\/]+[^&"']+)/i);
  return match ? match[1].replace(/[\\/]+/g, "/") : null;
}

function parseGold(value) {
  const text = visibleText(value).replaceAll(",", "");
  const fraction = text.match(/^([0-9]+(?:\.[0-9]+)?)\/([0-9]+(?:\.[0-9]+)?)$/);
  if (fraction) {
    const denominator = Number(fraction[2]);
    return denominator > 0 ? Number(fraction[1]) / denominator : null;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Parse the CurrencyExchange client-table rendering exposed by PoEDB/PoE2DB.
 * Heading order is the in-game sidebar/section/item order; no category names are
 * maintained here, so new league categories flow into the generated snapshot.
 */
export function parseExchangeLayoutHtml(html, { game, sourceUrl } = {}) {
  const source = String(html ?? "");
  const exchangeStart = source.search(/<h4[^>]*>\s*Currency Exchange\s*<\/h4>/i);
  if (exchangeStart < 0) throw new Error("Currency Exchange heading was not found");

  const body = source.slice(exchangeStart);
  const token = /<h5[^>]*>([\s\S]*?)<\/h5>|<div\b[^>]*class=(?:"[^"]*\bcurrency-exchange-subtitle\b[^"]*"|'[^']*\bcurrency-exchange-subtitle\b[^']*')[^>]*>([\s\S]*?)<\/div>|<div\b[^>]*class=(?:"[^"]*\bflex-grow-1\s+ms-2\s+d-flex\s+justify-content-between\s+align-items-center\b[^"]*"|'[^']*\bflex-grow-1\s+ms-2\s+d-flex\s+justify-content-between\s+align-items-center\b[^']*')[^>]*>\s*<a\b([^>]*)>([\s\S]*?)<\/a>\s*<span[^>]*>([\s\S]*?)<\/span>/gi;

  const categories = [];
  const items = [];
  let currentCategory = null;
  let currentSection = null;
  let categoryOrder = -1;
  let sectionOrder = -1;
  let itemOrder = -1;

  for (const match of body.matchAll(token)) {
    if (match[1] !== undefined) {
      currentCategory = visibleText(match[1]);
      currentSection = null;
      categoryOrder += 1;
      sectionOrder = -1;
      itemOrder = -1;
      categories.push({ name: currentCategory, order: categoryOrder, sections: [] });
      continue;
    }
    if (match[2] !== undefined) {
      if (!currentCategory) throw new Error("Section appeared before a category");
      currentSection = visibleText(match[2]);
      sectionOrder += 1;
      itemOrder = -1;
      categories.at(-1).sections.push({ name: currentSection, order: sectionOrder });
      continue;
    }
    if (!currentCategory || !currentSection) throw new Error("Item appeared before a category/section");
    const name = visibleText(match[4]);
    if (!name) throw new Error(`Empty item name in ${currentCategory} / ${currentSection}`);
    itemOrder += 1;
    const goldFeeText = visibleText(match[5]);
    items.push({
      name,
      normalizedName: normalizeExchangeName(name),
      metadataId: metadataIdFrom(match[3]),
      href: attribute(match[3], "href"),
      goldFeeText,
      goldPerUnit: parseGold(goldFeeText),
      category: currentCategory,
      section: currentSection,
      categoryOrder,
      sectionOrder,
      itemOrder,
    });
  }

  // The site navigation after the exchange card also uses h5 headings. Keep
  // only categories/sections that actually own exchange items, then compact
  // their order so unrelated page chrome can never leak into the sidebar.
  const usedLocations = new Set(items.map((item) => `${item.category}\u0000${item.section}`));
  const usedCategories = new Set(items.map((item) => item.category));
  const compactCategories = categories
    .filter(({ name }) => usedCategories.has(name))
    .map((category, nextCategoryOrder) => ({
      ...category,
      order: nextCategoryOrder,
      sections: category.sections
        .filter(({ name }) => usedLocations.has(`${category.name}\u0000${name}`))
        .map((section, nextSectionOrder) => ({ ...section, order: nextSectionOrder })),
    }));
  const categoryOrders = new Map(compactCategories.map((category) => [category.name, category.order]));
  const sectionOrders = new Map(compactCategories.flatMap((category) =>
    category.sections.map((section) => [`${category.name}\u0000${section.name}`, section.order])));
  for (const item of items) {
    item.categoryOrder = categoryOrders.get(item.category);
    item.sectionOrder = sectionOrders.get(`${item.category}\u0000${item.section}`);
  }

  if (compactCategories.length < 2 || items.length < 20) {
    throw new Error(`Implausible Currency Exchange layout: ${compactCategories.length} categories, ${items.length} items`);
  }
  if (!compactCategories.some(({ name }) => name === "Currency")) throw new Error("Currency category is missing");
  if (compactCategories.some(({ name }) => name.toLowerCase() === "popular")) throw new Error("Popular is a view, not an exchange category");

  const nameLocations = new Map();
  for (const item of items) {
    const location = `${item.category}\u0000${item.section}`;
    const prior = nameLocations.get(item.normalizedName);
    if (prior && prior !== location) {
      throw new Error(`Ambiguous item name across sections: ${item.name}`);
    }
    nameLocations.set(item.normalizedName, location);
  }

  return {
    version: 1,
    game: game === "poe1" ? "poe1" : "poe2",
    source: sourceUrl ?? null,
    itemCount: items.length,
    categories: compactCategories,
    items,
  };
}
