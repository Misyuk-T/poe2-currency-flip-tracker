import test from "node:test";
import assert from "node:assert/strict";

import { preloadIcons, resetPreloadedIcons } from "../apps/web/lib/preload-icons.js";

/** Minimal DOM stand-in: records every src assigned to a constructed Image. */
function withFakeWindow(run) {
  const requested = [];
  const originalWindow = globalThis.window;
  const originalImage = globalThis.Image;
  const queue = [];

  globalThis.window = {
    // No requestIdleCallback: exercise the setTimeout branch deterministically
    // by draining the queue by hand instead of waiting on real timers.
    setTimeout: (fn) => {
      queue.push(fn);
      return queue.length;
    },
  };
  globalThis.Image = class {
    set src(value) {
      requested.push(value);
    }
  };

  const drain = () => {
    while (queue.length) queue.shift()();
  };

  try {
    resetPreloadedIcons();
    return run({ requested, drain });
  } finally {
    globalThis.window = originalWindow;
    globalThis.Image = originalImage;
    resetPreloadedIcons();
  }
}

test("every distinct icon is requested once the queue drains", () => {
  withFakeWindow(({ requested, drain }) => {
    preloadIcons(["a.png", "b.png", "c.png"], { chunkSize: 2 });
    drain();
    assert.deepEqual(requested.sort(), ["a.png", "b.png", "c.png"]);
  });
});

test("work is spread across chunks instead of one burst", () => {
  withFakeWindow(({ requested, drain }) => {
    preloadIcons(["a.png", "b.png", "c.png", "d.png", "e.png"], { chunkSize: 2 });
    // Nothing runs until the scheduler fires.
    assert.equal(requested.length, 0);
    drain();
    assert.equal(requested.length, 5);
  });
});

test("duplicates within one call are collapsed", () => {
  withFakeWindow(({ requested, drain }) => {
    preloadIcons(["same.png", "same.png", "same.png"], { chunkSize: 10 });
    drain();
    assert.deepEqual(requested, ["same.png"]);
  });
});

test("an icon already warmed is not refetched by a later call", () => {
  withFakeWindow(({ requested, drain }) => {
    preloadIcons(["a.png", "b.png"], { chunkSize: 10 });
    drain();
    preloadIcons(["b.png", "c.png"], { chunkSize: 10 });
    drain();
    assert.deepEqual(requested, ["a.png", "b.png", "c.png"]);
  });
});

test("cancelling stops the remaining chunks", () => {
  withFakeWindow(({ requested, drain }) => {
    const cancel = preloadIcons(["a.png", "b.png", "c.png", "d.png"], { chunkSize: 1 });
    cancel();
    drain();
    assert.deepEqual(requested, []);
  });
});

test("empty and falsy entries are ignored rather than fetched", () => {
  withFakeWindow(({ requested, drain }) => {
    preloadIcons([null, undefined, "", "real.png"], { chunkSize: 10 });
    drain();
    assert.deepEqual(requested, ["real.png"]);
  });
});

test("nothing is scheduled when there is nothing new to warm", () => {
  withFakeWindow(({ requested, drain }) => {
    const cancel = preloadIcons([], { chunkSize: 10 });
    drain();
    assert.deepEqual(requested, []);
    assert.equal(typeof cancel, "function");
  });
});
