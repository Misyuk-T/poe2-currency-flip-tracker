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
 * GGG publishes a low/high range per hour and NO open or close, so a true OHLC
 * candle is impossible. A bucket spanning several hours, however, does contain
 * a first and a last hourly midpoint — both observed values — and that is
 * enough for a candle whose parts all mean something:
 *
 * - wick (`low`..`high`): every price the market actually touched in the bucket.
 * - body (`open`..`close`): the first and last hourly midpoints inside it, i.e.
 *   the net move across the bucket. NOT GGG's opening and closing trades, which
 *   do not exist in the feed — the naming is lightweight-charts', the meaning is
 *   ours, and the label under the chart says so.
 * - `line`: the median of the hourly midpoints, so one extreme hour cannot yank
 *   the trend the way first/last can.
 *
 * Previously the body spanned the whole low..high band with the wick hidden
 * inside it, which made a wide market render as one enormous block and threw
 * away the shape the bucket actually had. Colour follows the body — a real
 * comparison of two observed midpoints — not the previous bucket.
 *
 * At a 1-hour bucket there is no sub-structure to summarise: first and last are
 * the same midpoint, so the body collapses to a line across the wick. That is
 * the honest rendering of "one observation, no measurable move within it".
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
      bucket.last = point.reference;
      bucket.volume += pointVolume(point);
      bucket.low = Math.min(bucket.low, low);
      bucket.high = Math.max(bucket.high, high);
    } else {
      buckets.push({
        completedHour: bucketEnd,
        references: [point.reference],
        first: point.reference,
        last: point.reference,
        volume: pointVolume(point),
        low,
        high,
      });
    }
  }

  const rows = buckets.map((bucket) => {
    const reference = median(bucket.references);
    const time = Math.floor(bucket.completedHour / 1000);
    const up = bucket.last >= bucket.first;
    const color = up ? UP_COLOR : DOWN_COLOR;
    return {
      range: {
        time,
        // Body: first and last observed midpoint in the bucket. Wick: the full
        // touched range. Clamped so a body edge can never sit outside the range
        // it is drawn inside.
        open: Math.min(Math.max(bucket.first, bucket.low), bucket.high),
        close: Math.min(Math.max(bucket.last, bucket.low), bucket.high),
        low: bucket.low,
        high: bucket.high,
        color,
        borderColor: color,
        wickColor: "rgba(160, 170, 184, 0.85)",
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
