"use client";

import { useEffect, useMemo, useRef } from "react";
import { CandlestickSeries, HistogramSeries, LineSeries, createChart } from "lightweight-charts";
import { buildTrendRows } from "../lib/chart-series.js";

function precisionFor(rows) {
  const values = rows.flatMap((row) => [row.range.low, row.range.high]).filter(Number.isFinite);
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

export default function SpotChart({ points, height = 420, bucketHours: bucketHoursProp, loading = false }) {
  const hostRef = useRef(null);
  const { rows } = useMemo(() => buildTrendRows(points, bucketHoursProp), [points, bucketHoursProp]);
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

    // The observed low..high band, drawn as a body-only box. Added before the
    // midpoint line so the line reads on top of its own range.
    const range = chart.addSeries(CandlestickSeries, {
      priceFormat: { type: "price", precision, minMove },
      priceLineVisible: false,
      lastValueVisible: false,
    });
    range.setData(rows.map((row) => row.range));

    const midpoint = chart.addSeries(LineSeries, {
      color: "#f0b90b",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      priceFormat: { type: "price", precision, minMove },
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
    // Reserve the chart's height so the modal doesn't resize when history arrives.
    return (
      <div className="spot-chart-wrap">
        <div className="spot-chart spot-chart-placeholder" style={{ height }}>
          {loading ? (
            <span className="rt-spinner" aria-label="Loading chart" />
          ) : (
            <p>At least two completed hourly points are required.</p>
          )}
        </div>
      </div>
    );
  }

  const low = Math.min(...rows.map((row) => row.range.low));
  const high = Math.max(...rows.map((row) => row.range.high));
  const first = rows[0]?.line.time;
  const last = rows.at(-1)?.line.time;

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
