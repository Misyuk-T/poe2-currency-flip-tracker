"use client";

import { useEffect, useMemo, useRef } from "react";
import { CandlestickSeries, HistogramSeries, LineStyle, PriceScaleMode, createChart } from "lightweight-charts";
import { buildTrendRows, bulkPriceRange } from "../lib/chart-series.js";

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
        // A single outlier print — one hour that traded at a tenth of the going
        // rate — stretched a linear axis so far that every ordinary candle
        // collapsed into a band a few pixels tall. The extremes are real and
        // stay on the chart; a log scale just stops them from flattening
        // everything else. It also cannot render zero, so the axis can no longer
        // wander into negative prices.
        mode: PriceScaleMode.Logarithmic,
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
    const bulk = bulkPriceRange(rows);
    const range = chart.addSeries(CandlestickSeries, {
      priceFormat: { type: "price", precision, minMove },
      priceLineVisible: false,
      lastValueVisible: false,
      // Scale to where the market actually trades. Without this a single hour
      // reporting a low of 0.24 against a price of 48 pushed every real candle
      // into a sliver at the top of the pane.
      ...(bulk
        ? {
            autoscaleInfoProvider: () => ({
              priceRange: { minValue: bulk.minValue, maxValue: bulk.maxValue },
            }),
          }
        : {}),
    });
    range.setData(rows.map((row) => row.range));

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
