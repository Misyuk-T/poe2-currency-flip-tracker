import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CSS = readFileSync(fileURLToPath(new URL("../apps/web/app/globals.css", import.meta.url)), "utf8");

/**
 * A `var(--typo)` is invalid at computed-value time: the declaration is dropped
 * and the property inherits instead, so the page usually still LOOKS fine and
 * the mistake survives review. Two of them did (`--rl-text`, `--rl-accent`) and
 * were only found by reading the file for something else. This makes the next
 * one fail a test run instead.
 *
 * What it CANNOT catch: scope. The `--rl-*` tokens are declared only under
 * `.radar-light`, so reading one from an element outside that subtree is just
 * as broken and passes here. This is a typo guard, not a cascade checker.
 *
 * Both patterns tolerate this stylesheet's habit of putting a whole rule on one
 * line: a declaration is recognised after `{` or `;` as well as at line start,
 * and the `var()` pattern captures only the name, so a legal `var(--x, red)`
 * fallback reads correctly.
 */
test("every custom property the stylesheet reads is also declared in it", () => {
  const used = new Set([...CSS.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)].map((m) => m[1]));
  const declared = new Set([...CSS.matchAll(/(?:^|[{;])\s*(--[A-Za-z0-9_-]+)\s*:/gm)].map((m) => m[1]));
  const undefined_ = [...used].filter((name) => !declared.has(name)).sort();
  assert.deepEqual(undefined_, [], `undefined custom properties: ${undefined_.join(", ")}`);
});

/**
 * The app is dark-only. Without this the UA paints light scrollbars and light
 * form controls on every surface — the bug that put a white slab down the
 * middle of the dashboard.
 */
test("the stylesheet declares a dark color-scheme", () => {
  assert.match(CSS, /color-scheme:\s*dark/);
});
