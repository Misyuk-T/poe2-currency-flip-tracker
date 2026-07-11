"use client";

import { useEffect, useMemo, useRef } from "react";
import { CandlestickSeries, HistogramSeries, LineSeries, createChart } from "lightweight-charts";

// Keep the chart readable: once the horizon holds more hourly points than
// this, consecutive hours are merged into wider candles (2h/4h/…).
const TARGET_BARS = 60;
const BUCKET_HOURS = [1, 2, 4, 6, 12, 24];

function pickBucketHours(count) {
  return BUCKET_HOURS.find((step) => count / step <= TARGET_BARS) ?? BUCKET_HOURS.at(-1);
}

function pointVolume(point) {
  const volume = Number(point.volume?.[point.target] ?? point.volume?.[point.base] ?? 0);
  return Number.isFinite(volume) ? volume : 0;
}

function aggregatePoints(points, bucketHours) {
  if (bucketHours <= 1) return points.map((point) => ({ ...point, bucketVolume: pointVolume(point) }));
  const spanMs = bucketHours * 3_600_000;
  const out = [];
  for (const point of points) {
    const bucketEnd = Math.ceil((point.completedHour ?? 0) / spanMs) * spanMs;
    const prev = out.at(-1);
    if (prev && prev.completedHour === bucketEnd) {
      prev.low = Math.min(prev.low, point.low);
      prev.high = Math.max(prev.high, point.high);
      prev.reference = point.reference;
      prev.bucketVolume += pointVolume(point);
    } else {
      out.push({ ...point, completedHour: bucketEnd, bucketVolume: pointVolume(point) });
    }
  }
  return out;
}

function toChartRows(points, explicitBucketHours) {
  const usable = (points ?? [])
    .filter((point) => Number.isFinite(point?.reference) && Number.isFinite(point?.low) && Number.isFinite(point?.high))
    .sort((a, b) => (a.completedHour ?? 0) - (b.completedHour ?? 0));

  // Caller can pin the candle interval (the timeframe pills); otherwise auto-pick
  // a readable bucket size from the number of hourly points.
  const bucketHours = Number.isFinite(explicitBucketHours) && explicitBucketHours >= 1
    ? explicitBucketHours
    : pickBucketHours(usable.length);
  const aggregated = aggregatePoints(usable, bucketHours);

  const rows = aggregated.map((point, index) => {
    const prior = aggregated[index - 1]?.reference ?? point.reference;
    const time = Math.floor((point.completedHour ?? Date.now()) / 1000);
    const volume = point.bucketVolume;
    const up = point.reference >= prior;
    return {
      candle: {
        time,
        open: prior,
        high: Math.max(point.high, point.reference, prior),
        low: Math.min(point.low, point.reference, prior),
        close: point.reference,
      },
      line: { time, value: point.reference },
      volume: {
        time,
        value: Number.isFinite(volume) ? volume : 0,
        color: up ? "rgba(14, 203, 129, 0.36)" : "rgba(246, 70, 93, 0.36)",
      },
    };
  });

  return { rows, bucketHours };
}

function precisionFor(rows) {
  const values = rows.flatMap((row) => [row.candle.low, row.candle.high]).filter(Number.isFinite);
  const magnitude = Math.max(...values.map(Math.abs), 0);
  if (magnitude < 0.01) return 6;
  if (magnitude < 1) return 4;
  if (magnitude < 100) return 3;
  return 2;
}

function fmt(value, precision) {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: precision }).format(value);
}

function timeLabel(timestamp) {
  if (!Number.isFinite(timestamp)) return "—";
  return new Date(timestamp * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function SpotChart({ points, height = 420, bucketHours: bucketHoursProp }) {
  const hostRef = useRef(null);
  const { rows } = useMemo(() => toChartRows(points, bucketHoursProp), [points, bucketHoursProp]);
  const precision = useMemo(() => precisionFor(rows), [rows]);

  useEffect(() => {
    if (!hostRef.current || rows.length < 2) return;
    const host = hostRef.current;
    host.replaceChildren();
    const minMove = 10 ** -precision;

    const chart = createChart(host, {
      height,
      autoSize: true,
      layout: {
        background: { color: "#0b0e11" },
        textColor: "#b7bdc6",
        fontFamily: "Inter, system-ui, sans-serif",
      },
      grid: {
        vertLines: { color: "rgba(132, 142, 156, 0.12)" },
        horzLines: { color: "rgba(132, 142, 156, 0.12)" },
      },
      crosshair: { mode: 0 },
      rightPriceScale: {
        borderColor: "rgba(132, 142, 156, 0.24)",
        scaleMargins: { top: 0.08, bottom: 0.24 },
      },
      timeScale: {
        borderColor: "rgba(132, 142, 156, 0.24)",
        timeVisible: true,
        secondsVisible: false,
      },
    });

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: "#0ecb81",
      downColor: "#f6465d",
      borderUpColor: "#0ecb81",
      borderDownColor: "#f6465d",
      wickUpColor: "#0ecb81",
      wickDownColor: "#f6465d",
      priceFormat: { type: "price", precision, minMove },
    });
    candles.setData(rows.map((row) => row.candle));

    const midpoint = chart.addSeries(LineSeries, {
      color: "#f0b90b",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    midpoint.setData(rows.map((row) => row.line));

    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "",
      base: 0,
    });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });
    volume.setData(rows.map((row) => row.volume));

    chart.timeScale().fitContent();

    return () => {
      chart.remove();
    };
  }, [height, precision, rows]);

  if (rows.length < 2) {
    return <p className="chart-empty">At least two completed hourly points are required.</p>;
  }

  const low = Math.min(...rows.map((row) => row.candle.low));
  const high = Math.max(...rows.map((row) => row.candle.high));
  const first = rows[0]?.candle.time;
  const last = rows.at(-1)?.candle.time;

  return (
    <div className="spot-chart-wrap">
      <div className="spot-chart-meta">
        <span>high {fmt(high, precision)}</span>
        <span>{timeLabel(first)} → {timeLabel(last)}</span>
        <span>low {fmt(low, precision)}</span>
      </div>
      <div className="spot-chart" ref={hostRef} style={{ height }} />
    </div>
  );
}
