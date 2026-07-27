/**
 * Warm the browser's image cache for icons that aren't on screen yet.
 *
 * Switching category or league re-mounts the table, so its icons used to paint
 * blank and fill in a moment later. This is half the fix: it puts every icon in
 * the payload into the HTTP cache ahead of time. The other half is that the row
 * icons dropped `loading="lazy"` — lazy defers the *start* of a load until the
 * browser's intersection pass, so a cached icon still painted blank for a beat.
 * Warming first is what makes dropping lazy cheap: by then the request is a
 * cache hit rather than a fresh round trip.
 *
 * Done in chunks on idle callbacks rather than one burst so it stays behind the
 * radar/history fetches the page actually needs.
 */

const CHUNK_SIZE = 64;

const requested = new Set();

/** Kick off a background warm-up. Returns a function that cancels the rest. */
export function preloadIcons(urls, { chunkSize = CHUNK_SIZE, schedule = defaultSchedule } = {}) {
  if (typeof window === "undefined") return () => {};
  const pending = [...new Set(urls)].filter((url) => url && !requested.has(url));
  if (!pending.length) return () => {};

  let cancelled = false;
  let index = 0;

  function step() {
    if (cancelled) return;
    const slice = pending.slice(index, index + chunkSize);
    index += chunkSize;
    for (const url of slice) {
      // Marked as requested up front: the point is to populate the HTTP cache,
      // and a failed URL should not be retried on every later warm-up either.
      requested.add(url);
      const img = new Image();
      img.decoding = "async";
      img.src = url;
    }
    if (index < pending.length) schedule(step);
  }

  schedule(step);
  return () => {
    cancelled = true;
  };
}

function defaultSchedule(run) {
  // Idle time keeps this behind rendering and the radar/history fetches, but a
  // short timeout matters more than politeness here: a full radar is ~600 icons
  // and the whole point is to finish before the user switches category. Waiting
  // on genuine idle drained barely a third of them in seven seconds.
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(run, { timeout: 300 });
  } else {
    window.setTimeout(run, 50);
  }
}

/** Test seam: forget what has already been warmed. */
export function resetPreloadedIcons() {
  requested.clear();
}
