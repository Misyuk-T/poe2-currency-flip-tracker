import catalog from "../../../src/data/catalog-poe2.json" with { type: "json" };

export const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
// Same-origin by default: the hosted app calls its own Next /api/* route
// handlers. Override with NEXT_PUBLIC_API_BASE_URL=/backend for local dev
// against the always-on Node server.
export const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

export const popularCurrencies = [
  { id: "divine", name: "Divine Orb", summary: "High-value anchor market for larger flips and overnight price checks." },
  { id: "exalted", name: "Exalted Orb", summary: "Primary liquid trading currency for small and mid-sized market moves." },
  { id: "chaos", name: "Chaos Orb", summary: "Deep market often useful for reading broad currency demand." },
  { id: "vaal", name: "Vaal Orb", summary: "Active crafting currency with frequent short-term movement." },
  { id: "greater-exalted-orb", name: "Greater Exalted Orb", summary: "Higher-tier currency where hourly range and liquidity matter more than raw spread." },
  { id: "fracturing-orb", name: "Fracturing Orb", summary: "Expensive market where stale prices can be costly." },
];

export function currencyName(id) {
  return popularCurrencies.find((currency) => currency.id === id)?.name ?? titleize(id);
}

export function titleize(id) {
  return String(id ?? "")
    .split("-")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

// GGG item art is © GGG and is NOT committed to the repo. Rather than self-host
// per-item PNGs (the Vercel build has no step to download them), the UI hotlinks
// GGG's official image CDN via the URL carried in the committed catalog metadata
// — the same approach poe.ninja / poe2scout use. Ids with no catalog image fall
// back to the neutral committed glyph via the <img onError> handler.
export const fallbackIconUrl = "/icons/_fallback.svg";

// id -> official GGG image URL, from the committed catalog metadata.
const ICON_URLS = new Map(
  (catalog.items ?? []).filter((item) => item.id && item.image).map((item) => [item.id, item.image]),
);

export function iconUrl(id) {
  return (id && ICON_URLS.get(id)) || fallbackIconUrl;
}

/**
 * Pure: pick the biggest 24h movers from an /api/radar payload for the homepage
 * mini-radar. Tradable rows only (a real pair, traded this hour, finite move),
 * ranked by absolute 24h move. Also surfaces whether the feed is sample data so
 * the widget can label it honestly. Kept here (plain JS) so it is unit-testable.
 */
export function selectTopMovers(data, { limit = 5, includeStale = false } = {}) {
  const movers = (data?.rows ?? [])
    .filter(
      (row) =>
        row?.pairId &&
        row.status !== "no-trades-this-hour" &&
        // By default never surface a stale move as a current "top mover"; the
        // homepage rail opts in (includeStale) since the panel labels the data
        // and shows its age, so the rail is never empty when data exists.
        (includeStale || !row.stale) &&
        Number.isFinite(row.movement?.h24),
    )
    .sort((a, b) => Math.abs(b.movement.h24) - Math.abs(a.movement.h24))
    .slice(0, Math.max(0, limit));
  return { movers, sample: data?.source?.sourceMode === "fixture" };
}

export function formatNumber(value, { maximumFractionDigits = 2, minimumFractionDigits = 0 } = {}) {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits, minimumFractionDigits }).format(value);
}

export function displayDigits(value) {
  const abs = Math.abs(Number(value));
  if (!Number.isFinite(abs)) return 2;
  if (abs >= 100) return 0;
  if (abs >= 1) return 2;
  if (abs >= 0.01) return 4;
  return 6;
}

export function formatPercent(value, { signed = true, maximumFractionDigits = 2 } = {}) {
  if (!Number.isFinite(value)) return "—";
  const prefix = signed && value > 0 ? "+" : "";
  return `${prefix}${formatNumber(value * 100, { maximumFractionDigits })}%`;
}

export function formatDurationHours(value) {
  if (!Number.isFinite(value)) return "—";
  if (value < 1) return `${Math.max(1, Math.round(value * 60))}m`;
  return `${formatNumber(value, { maximumFractionDigits: value >= 10 ? 0 : 1 })}h`;
}

export function formatAge(ageMs) {
  if (!Number.isFinite(ageMs)) return "unknown age";
  const minutes = Math.max(0, Math.round(ageMs / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 48) return rest ? `${hours}h ${rest}m ago` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
