import {
  currencyName,
  displayDigits,
  formatAge,
  formatNumber,
  formatPercent,
  popularCurrencies,
  siteUrl,
} from "../lib/market.js";
import HomeMiniRadar from "../components/HomeMiniRadar.jsx";

export const revalidate = 3600;

export const metadata = {
  title: "PoE2 Currency Flip Tracker",
  description:
    "Use official Path of Exile 2 hourly market data to spot currency movement, verify your current quote, and plan conservative entry and exit levels.",
  alternates: { canonical: siteUrl },
};

const CHART_WIDTH = 720;
const CHART_HEIGHT = 330;

function finite(value) {
  return Number.isFinite(Number(value));
}

function midpoint(summary) {
  if (finite(summary?.reference)) return Number(summary.reference);
  if (finite(summary?.low) && finite(summary?.high)) return (Number(summary.low) + Number(summary.high)) / 2;
  return null;
}

function unitLabel(anchor) {
  return anchor === "exalted" ? "Exalted Orbs" : currencyName(anchor);
}

function priceText(value, unit, options = {}) {
  if (!finite(value)) return "—";
  const digits = displayDigits(Number(value));
  return `${formatNumber(Number(value), {
    maximumFractionDigits: options.maximumFractionDigits ?? digits,
    minimumFractionDigits: options.minimumFractionDigits ?? 0,
  })}${options.withUnit ? ` ${unit}` : ""}`;
}

function rangeText(low, high, unit) {
  if (!finite(low) || !finite(high)) return "—";
  return `${priceText(low, unit)}–${priceText(high, unit)} ${unit}`;
}

function latestHourText(value) {
  if (!value) return "latest completed hour";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "latest completed hour";
  return `completed ${formatAge(Date.now() - date.getTime())}`;
}

function planFromRange(summary) {
  const mid = midpoint(summary);
  const low = Number(summary?.low);
  const high = Number(summary?.high);
  if (!finite(mid) || !finite(low) || !finite(high) || high <= low) return null;
  const width = high - low;
  return {
    entryLow: Math.max(low, mid - width * 0.32),
    entryHigh: Math.max(low, mid - width * 0.12),
    exitLow: Math.min(high, mid + width * 0.16),
    exitHigh: Math.min(high, mid + width * 0.45),
  };
}

function chartModel(summary) {
  const points = Array.isArray(summary?.series) ? summary.series.filter((p) => finite(p.low) && finite(p.high) && finite(p.reference)) : [];
  if (points.length < 2) return null;

  const pad = { left: 54, right: 84, top: 28, bottom: 46 };
  const values = points.flatMap((p) => [Number(p.low), Number(p.high), Number(p.reference)]);
  let min = Math.min(...values);
  let max = Math.max(...values);
  const spread = max - min || Math.max(1, max * 0.08);
  min -= spread * 0.18;
  max += spread * 0.18;

  const plotWidth = CHART_WIDTH - pad.left - pad.right;
  const plotHeight = CHART_HEIGHT - pad.top - pad.bottom;
  const x = (index) => pad.left + (index / (points.length - 1)) * plotWidth;
  const y = (value) => pad.top + ((max - Number(value)) / (max - min)) * plotHeight;
  const fmt = (value) => `${Math.round(value * 10) / 10}`;
  const high = points.map((p, index) => `${x(index).toFixed(1)},${y(p.high).toFixed(1)}`);
  const low = points.map((p, index) => `${x(index).toFixed(1)},${y(p.low).toFixed(1)}`);
  const mid = points.map((p, index) => `${x(index).toFixed(1)},${y(p.reference).toFixed(1)}`);
  const latest = points[points.length - 1];

  return {
    band: `${high.join(" ")} ${low.toReversed().join(" ")}`,
    highLine: high.join(" "),
    lowLine: low.join(" "),
    midLine: mid.join(" "),
    yTicks: [
      { label: fmt(max), y: pad.top },
      { label: fmt((max + min) / 2), y: pad.top + plotHeight / 2 },
      { label: fmt(min), y: pad.top + plotHeight },
    ],
    labels: [
      { label: "-24h", x: pad.left, y: CHART_HEIGHT - 12 },
      { label: "-12h", x: pad.left + plotWidth / 2, y: CHART_HEIGHT - 12 },
      { label: "Now", x: pad.left + plotWidth, y: CHART_HEIGHT - 12 },
    ],
    latest,
    latestY: {
      high: y(latest.high),
      mid: y(latest.reference),
      low: y(latest.low),
    },
  };
}

function movementLabel(value) {
  if (!finite(value)) return "—";
  const arrow = Number(value) >= 0 ? "▲" : "▼";
  return `${arrow} ${formatPercent(Number(value))}`;
}

function HeroChart({ model, unit }) {
  if (!model) {
    return (
      <div className="home-chart-empty" aria-label="Hourly range chart unavailable">
        <svg className="home-chart" viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} aria-hidden="true">
          <defs>
            <pattern id="homeHeroGridEmpty" width="86" height="48" patternUnits="userSpaceOnUse">
              <path d="M 86 0 L 0 0 0 48" />
            </pattern>
          </defs>
          <rect className="home-chart-grid home-chart-grid-empty" width={CHART_WIDTH} height={CHART_HEIGHT} />
          <path className="home-chart-orbit" d="M76 228 C190 90 336 76 486 172 S650 238 684 114" />
        </svg>
        <p>Waiting for at least two completed hourly points.</p>
      </div>
    );
  }

  return (
    <svg className="home-chart" viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} role="img" aria-label={`Divine Orb hourly range in ${unit}`}>
      <defs>
        <pattern id="homeHeroGrid" width="86" height="48" patternUnits="userSpaceOnUse">
          <path d="M 86 0 L 0 0 0 48" />
        </pattern>
      </defs>
      <rect className="home-chart-grid home-chart-grid-live" width={CHART_WIDTH} height={CHART_HEIGHT} />
      <polygon className="home-chart-range" points={model.band} />
      <polyline className="home-chart-boundary" points={model.highLine} />
      <polyline className="home-chart-boundary home-chart-boundary-low" points={model.lowLine} />
      <polyline className="home-chart-mid" points={model.midLine} />
      {model.yTicks.map((tick) => (
        <text className="home-chart-axis" x="14" y={tick.y + 4} key={tick.label}>
          {tick.label}
        </text>
      ))}
      {model.labels.map((label) => (
        <text className="home-chart-axis home-chart-x" x={label.x} y={label.y} key={label.label}>
          {label.label}
        </text>
      ))}
      {[
        ["high", model.latest.high],
        ["mid", model.latest.reference],
        ["low", model.latest.low],
      ].map(([kind, value]) => (
        <g className={`home-price-tag ${kind}`} transform={`translate(638 ${model.latestY[kind] - 15})`} key={kind}>
          <path d="M12 0 H70 Q76 0 76 6 V24 Q76 30 70 30 H12 L0 15 Z" />
          <text x="19" y="20">{priceText(value, unit, { maximumFractionDigits: displayDigits(Number(value)) })}</text>
        </g>
      ))}
    </svg>
  );
}

function DivineHeroCard({ summary }) {
  const unit = unitLabel(summary.anchor);
  const mid = midpoint(summary);
  const plan = planFromRange(summary);
  const model = chartModel(summary);
  const movement = summary.movement?.h24;

  return (
    <section className="home-product-card" aria-label="Divine Orb planning context">
      <div className="home-card-topline">
        <div>
          <p className="eyebrow">Planning context, not executable quotes</p>
          <h2>Divine Orb</h2>
        </div>
        {summary.sourceMode === "fixture" ? <span className="home-data-badge">sample data</span> : null}
      </div>

      <div className="home-card-grid">
        <div className="home-chart-panel">
          <div className="home-chart-heading">
            <div>
              <strong>Hourly range (min–max)</strong>
              <span>Last {Math.max(0, summary.samples ?? summary.series?.length ?? 0)} completed-hour samples</span>
            </div>
            <div className="home-chart-legend">
              <span><i className="legend-range" /> Range band</span>
              <span><i className="legend-midpoint" /> Midpoint</span>
            </div>
          </div>
          <HeroChart model={model} unit={unit} />
          <div className="home-metric-tiles">
            <article>
              <span>24h move</span>
              <strong className={Number(movement) >= 0 ? "home-teal" : "home-loss"}>{movementLabel(movement)}</strong>
            </article>
            <article>
              <span>Activity score</span>
              <strong>{finite(summary.activityScore) ? `${Math.round(Number(summary.activityScore))}/100` : "—/100"}</strong>
            </article>
            <article>
              <span>Observed now</span>
              <strong className="home-teal">{priceText(mid, unit, { withUnit: true })}</strong>
            </article>
          </div>
        </div>

        <aside className="home-plan-column" aria-label="Derived planning values">
          <article className="home-side-panel observed">
            <span>Observed price (now)</span>
            <strong>{priceText(mid, unit)}</strong>
            <em>{unit}</em>
            <small>{latestHourText(summary.latestCompletedHour)} · range-midpoint proxy</small>
          </article>
          <article className="home-side-panel">
            <span>Plan (1–24h outlook)</span>
            <div>
              <small>Entry</small>
              <strong>{plan ? rangeText(plan.entryLow, plan.entryHigh, unit) : "—"}</strong>
            </div>
            <div>
              <small>Exit</small>
              <strong className="home-gold">{plan ? rangeText(plan.exitLow, plan.exitHigh, unit) : "—"}</strong>
            </div>
          </article>
        </aside>
      </div>
    </section>
  );
}

export default async function HomePage() {
  let summary = null;
  try {
    const { getCurrencySummary } = await import("../lib/currency-summary.js");
    summary = await getCurrencySummary("divine");
  } catch {
    summary = null;
  }

  return (
    <main className="home-page">
      <section className="home-hero">
        <div className="home-hero-copy">
          <p className="eyebrow">Path of Exile 2 currency market radar</p>
          <h1>Hourly data. Better flips.</h1>
          <p>
            Read completed-hour market ranges as context, then open the radar to plan around the price you can actually
            verify in game.
          </p>
        </div>
        {summary ? <DivineHeroCard summary={summary} /> : null}
        <HomeMiniRadar />
        <a className="home-primary-cta" href="/poe2">Open market radar</a>
      </section>

      <section className="home-seo-copy" aria-label="Why use this tracker">
        <article>
          <h2>Hourly data, clearly labelled</h2>
          <p>Official completed-hour ranges are useful for day-scale moves, but they are not live executable quotes.</p>
        </article>
        <article>
          <h2>Manual current price</h2>
          <p>Enter your real Divine or Exalted price, then rebase the plan around the market you can actually trade.</p>
        </article>
        <article>
          <h2>Currency pages for research</h2>
          <p>Each indexable currency page links back into the radar, so search visitors can move from context to action.</p>
        </article>
      </section>

      <section className="home-currency-links">
        <div>
          <p className="eyebrow">Popular PoE2 currency markets</p>
          <h2>Start with the liquid stuff.</h2>
        </div>
        <div className="home-currency-grid">
          {popularCurrencies.slice(0, 6).map((currency) => (
            <a href={`/poe2/currencies/${currency.id}`} key={currency.id}>
              <strong>{currency.name}</strong>
              <span>{currency.summary}</span>
            </a>
          ))}
        </div>
      </section>
    </main>
  );
}
