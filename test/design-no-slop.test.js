import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const css = readFileSync(fileURLToPath(new URL("../src/public/styles.css", import.meta.url)), "utf8");

// Guards the anti-AI-slop design rules (plan §4): no decorative single-side
// border accents, no decorative full-page gradients.
test("no decorative border-left accents", () => {
  assert.equal(/border-left\s*:/.test(css), false, "found a border-left accent");
});

test("no decorative border-top accents", () => {
  assert.equal(/border-top\s*:/.test(css), false, "found a border-top accent");
});

test("no radial-gradient backgrounds", () => {
  assert.equal(/radial-gradient/.test(css), false, "found a radial-gradient");
});

test("the only gradient is the functional loading shimmer", () => {
  const gradients = css.match(/linear-gradient/g) ?? [];
  assert.ok(gradients.length <= 1, `expected <=1 linear-gradient (shimmer), found ${gradients.length}`);
  if (gradients.length === 1) {
    assert.ok(/\.skeleton[^}]*linear-gradient/s.test(css), "the lone gradient must be the .skeleton shimmer");
  }
});
