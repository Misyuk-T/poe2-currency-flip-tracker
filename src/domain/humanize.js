/**
 * "Metadata/Items/Currency/CurrencyRerollRare" -> "Currency Reroll Rare".
 *
 * Lives apart from cx-identity.js on purpose. It is a pure string function with
 * no data behind it, but it was exported from the module that resolves the
 * identity JSON off disk — so every importer, including the SEO currency pages,
 * dragged a filesystem read into its bundle just to title-case a string. In
 * Next's bundled page runtime that read throws at module scope, which took the
 * whole page's data down with it.
 */
export function humanize(metadataId) {
  const leaf = String(metadataId).split("/").pop() ?? "";
  const words = leaf
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .split(/[\s_]+/)
    .filter(Boolean);
  return words.join(" ") || String(metadataId);
}
