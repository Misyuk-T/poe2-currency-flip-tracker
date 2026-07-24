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

/**
 * Build an indicative trend from official hourly range midpoints.
 *
 * These records are not exchange OHLC candles: GGG exposes a low/high range
 * and this app derives a midpoint proxy. Median-bucketing prevents a single
 * extreme fill from becoming a fake candlestick wick and flattening the useful
 * part of the chart, while keeping the underlying hourly points untouched.
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
    const bucket = buckets.at(-1);
    if (bucket?.completedHour === bucketEnd) {
      bucket.references.push(point.reference);
      bucket.volume += pointVolume(point);
    } else {
      buckets.push({
        completedHour: bucketEnd,
        references: [point.reference],
        volume: pointVolume(point),
      });
    }
  }

  const rows = buckets.map((bucket, index) => {
    const reference = median(bucket.references);
    const prior = median(buckets[index - 1]?.references ?? []) ?? reference;
    const time = Math.floor(bucket.completedHour / 1000);
    return {
      line: { time, value: reference },
      volume: {
        time,
        value: bucket.volume,
        color: reference >= prior ? "rgba(14, 203, 129, 0.36)" : "rgba(246, 70, 93, 0.36)",
      },
      samples: bucket.references.length,
    };
  });

  return { rows, bucketHours };
}
