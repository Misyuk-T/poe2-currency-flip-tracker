"use client";

import { useEffect, useMemo, useRef } from "react";
import { CandlestickSeries, HistogramSeries, LineStyle, createChart } from "lightweight-charts";
import { buildTrendRows } from "../lib/chart-series.js";

function precisionFor(rows) {
  const values = rows.flatMap((row) => [row.range.low, row.range.high]).filter(Number.isFinite);
  const magnitude = Math.max(...values.map(Math.abs), 0);
  if (magnitude < 0.01) return 6;
  if (magnitude < 1) return 4;
  if (magnitude < 100) return 3;
  return 2;
}

/**
 * @param {{ levels?: Array<{ price: number, label: string, color: string }> }} props
 *   `levels` draws the plan onto the history — the buy, the working price and
 *   the sell. Without them the chart is a picture of the past; with them it
 *   answers the question actually being asked: have these levels been inside
 *   the market before?
 */
export default function SpotChart({ points, height = 420, bucketHours: bucketHoursProp, loading = false, levels = [] }) {
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

    // Body = first/last hourly midpoint in the bucket, wick = the full touched
    // range (see buildTrendRows). Added before the midpoint line so the line
    // reads on top of its own candles.
    const range = chart.addSeries(CandlestickSeries, {
      priceFormat: { type: "price", precision, minMove },
      priceLineVisible: false,
      lastValueVisible: false,
    });
    range.setData(rows.map((row) => row.range));

    // A price is never negative, yet the axis printed -1000 for a currency whose
    // low was 500. The cause is not the autoscale — clamping that changes
    // nothing — it is the bottom scale margin that reserves room for the volume
    // histogram, which is applied AFTER the data range and drags the visible
    // floor below it. Shrink the margin to whatever still lands on zero.
    //   visible span S = (max - min) / (1 - top - bottom)
    //   floor         = min - S * bottom  >= 0
    const dataMin = Math.min(...rows.map((row) => row.range.low));
    const dataMax = Math.max(...rows.map((row) => row.range.high));
    const topMargin = 0.08;
    const maxBottom = dataMax > 0 ? (dataMin * (1 - topMargin)) / dataMax : 0;
    chart.priceScale("right").applyOptions({
      scaleMargins: { top: topMargin, bottom: Math.max(0, Math.min(0.24, maxBottom)) },
    });

    for (const level of levels) {
      if (!Number.isFinite(level?.price)) continue;
      range.createPriceLine({
        price: level.price,
        color: level.color,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: level.label,
      });
    }

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
  }, [height, levels, precision, rows]);

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

  // The high/low/date strip that used to sit here repeated both axes.
  return (
    <div className="spot-chart-wrap">
      <div className="spot-chart" ref={hostRef} style={{ height }} />
    </div>
  );
}
