const TARGET_BARS = 60;
const BUCKET_HOURS = [1, 2, 4, 6, 12, 24];

function pickBucketHours(count) {
  return BUCKET_HOURS.find((step) => count / step <= TARGET_BARS) ?? BUCKET_HOURS.at(-1);
}

function pointVolume(point) {
  const volume = Number(point.volume?.[point.target] ?? point.volume?.[point.base] ?? 0);
  return Number.isFinite(volume) ? volume : 0;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export const UP_COLOR = "#0ecb81";
export const DOWN_COLOR = "#f6465d";

/**
 * Build a trend series from official hourly records.
 *
 * GGG publishes a low/high range per hour and NO open/close, so this emits two
 * things and is careful about which is which:
 *
 * - `range`: the real traded band — the lowest low and highest high actually
 *   observed in the bucket. Drawn as a plain box (a candlestick body spanning
 *   low->high with no wick), NOT as an OHLC candle: an OHLC body would have to
 *   invent an open and a close, which is exactly the fabrication this replaced.
 * - `line`: the median of the hourly midpoints, as an indicative trend. Median
 *   rather than last, so one extreme fill can't yank the whole bucket.
 *
 * Direction colouring compares this bucket's median against the previous
 * bucket's — a real comparison between two observed values.
 */
export function buildTrendRows(points, explicitBucketHours) {
  const usable = (points ?? [])
    .filter((point) => Number.isFinite(point?.reference) && point.reference > 0)
    .sort((a, b) => (a.completedHour ?? 0) - (b.completedHour ?? 0));
  const bucketHours = Number.isFinite(explicitBucketHours) && explicitBucketHours >= 1
    ? explicitBucketHours
    : pickBucketHours(usable.length);
  const spanMs = bucketHours * 3_600_000;
  const buckets = [];

  for (const point of usable) {
    const completedHour = Number(point.completedHour) || Date.now();
    const bucketEnd = Math.ceil(completedHour / spanMs) * spanMs;
    // Fall back to the midpoint when an hour carries no usable band, so a
    // partial record still contributes its observed price instead of nothing.
    const low = Number.isFinite(point.low) && point.low > 0 ? point.low : point.reference;
    const high = Number.isFinite(point.high) && point.high > 0 ? point.high : point.reference;
    const bucket = buckets.at(-1);
    if (bucket?.completedHour === bucketEnd) {
      bucket.references.push(point.reference);
      bucket.volume += pointVolume(point);
      bucket.low = Math.min(bucket.low, low);
      bucket.high = Math.max(bucket.high, high);
    } else {
      buckets.push({
        completedHour: bucketEnd,
        references: [point.reference],
        volume: pointVolume(point),
        low,
        high,
      });
    }
  }

  const rows = buckets.map((bucket, index) => {
    const reference = median(bucket.references);
    const prior = median(buckets[index - 1]?.references ?? []) ?? reference;
    const time = Math.floor(bucket.completedHour / 1000);
    const up = reference >= prior;
    const color = up ? UP_COLOR : DOWN_COLOR;
    return {
      // open/close are the band edges, not a fabricated open/close: this draws
      // a box covering exactly the observed low..high, with no wick.
      range: {
        time,
        open: bucket.low,
        close: bucket.high,
        low: bucket.low,
        high: bucket.high,
        color,
        borderColor: color,
        wickColor: color,
      },
      line: { time, value: reference },
      volume: {
        time,
        value: bucket.volume,
        color: up ? "rgba(14, 203, 129, 0.36)" : "rgba(246, 70, 93, 0.36)",
      },
      samples: bucket.references.length,
    };
  });

  return { rows, bucketHours };
}
