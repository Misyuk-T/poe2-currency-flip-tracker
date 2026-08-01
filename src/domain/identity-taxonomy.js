import { humanize } from "./humanize.js";

const MIN_PREFIX_PARTS = 3;

export function normalizeIdentityName(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Learn a conservative identity -> official trade category resolver.
 *
 * Exact official ids/names seed the model. Unlisted items may inherit a
 * category only from a path prefix that has at least `minPrefixSupport` exact
 * examples and zero conflicting categories. This catches new siblings such as
 * Lineage gems and Ritual idols without maintaining an item-name override list.
 */
export function buildIdentityTaxonomy({ catalogItems = [], identities = {}, observedIds = new Set(), minPrefixSupport = 2 } = {}) {
  const officialById = new Map();
  const officialByName = new Map();
  const categoryByNormalizedLabel = new Map();
  for (const item of catalogItems) {
    if (!item?.id || !item?.category) continue;
    officialById.set(item.id, item);
    const key = normalizeIdentityName(item.name);
    if (!key) continue;
    const matches = officialByName.get(key) ?? [];
    matches.push(item);
    officialByName.set(key, matches);
  }
  for (const category of new Set(catalogItems.map((item) => item?.category).filter(Boolean))) {
    categoryByNormalizedLabel.set(normalizeIdentityName(category), category);
  }

  const exact = (metadataId, entry) => {
    const byId = officialById.get(metadataId) ?? officialById.get(entry?.shortId);
    if (byId) return { category: byId.category, taxonomySource: "official-id", taxonomyConfidence: 1 };
    const byName = officialByName.get(normalizeIdentityName(entry?.name));
    if (byName?.length === 1) {
      return { category: byName[0].category, taxonomySource: "official-name", taxonomyConfidence: 1 };
    }
    return null;
  };

  const prefixStats = new Map();
  for (const [metadataId, entry] of Object.entries(identities)) {
    if (!observedIds.has(metadataId)) continue;
    const seed = exact(metadataId, entry);
    if (!seed) continue;
    for (const prefix of identityPrefixes(metadataId, entry?.art)) {
      const stats = prefixStats.get(prefix) ?? { count: 0, categories: new Set() };
      stats.count += 1;
      stats.categories.add(seed.category);
      prefixStats.set(prefix, stats);
    }
  }

  const learnedPrefixes = new Map();
  for (const [prefix, stats] of prefixStats) {
    if (stats.count >= minPrefixSupport && stats.categories.size === 1) {
      learnedPrefixes.set(prefix, { category: [...stats.categories][0], support: stats.count });
    }
  }

  return (metadataId, entry = {}) => {
    const official = exact(metadataId, entry);
    if (official) return official;

    const officialPathCategories = String(metadataId ?? "")
      .split("/")
      .map((segment, index) => ({ category: categoryByNormalizedLabel.get(normalizeIdentityName(segment)), index }))
      .filter((candidate) => candidate.category && candidate.index >= MIN_PREFIX_PARTS)
      .sort((a, b) => b.index - a.index);
    if (officialPathCategories.length > 0) {
      return {
        category: officialPathCategories[0].category,
        taxonomySource: "official-path-token",
        taxonomyConfidence: 0.95,
        taxonomyEvidence: String(metadataId).split("/")[officialPathCategories[0].index],
      };
    }

    const inferred = (observedIds.has(metadataId) ? identityPrefixes(metadataId, entry.art) : [])
      .map((prefix) => ({ prefix, ...learnedPrefixes.get(prefix) }))
      .filter((candidate) => candidate.category)
      .sort((a, b) => b.prefix.length - a.prefix.length || b.support - a.support);
    if (inferred.length > 0) {
      return {
        category: inferred[0].category,
        taxonomySource: "learned-prefix",
        taxonomyConfidence: 0.9,
        taxonomyEvidence: inferred[0].prefix,
      };
    }

    if (entry.class) {
      return {
        category: humanize(entry.class),
        taxonomySource: "repo-class",
        taxonomyConfidence: 0.5,
      };
    }
    return { category: null, taxonomySource: "unresolved", taxonomyConfidence: 0 };
  };
}

function identityPrefixes(metadataId, art) {
  const out = new Set();
  for (const path of [metadataId, art]) {
    if (typeof path !== "string") continue;
    const parts = path.split("/").filter(Boolean);
    for (let length = MIN_PREFIX_PARTS; length < parts.length; length += 1) {
      out.add(parts.slice(0, length).join("/"));
    }
  }
  return [...out];
}
