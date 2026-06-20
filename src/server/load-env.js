/**
 * Minimal, dependency-free `.env` loader (Node >= 20 compatible).
 *
 * Node 20.6+ has `--env-file`, and 20.12+/22 has `--env-file-if-exists`, but
 * those are version-sensitive and abort startup if the flag is unsupported. To
 * keep the documented `cp .env.example .env && node src/server/index.js` flow
 * working across all Node >= 20, we parse `.env` ourselves.
 *
 * Rules (a deliberately small subset of dotenv):
 *   - `KEY=VALUE` lines; `export KEY=VALUE` is tolerated;
 *   - blank lines and line-start `#` comments are ignored; an inline `#` comment
 *     after an UNQUOTED value is stripped (quoted values keep their `#`);
 *   - surrounding single/double quotes are stripped (and `\n` unescaped in
 *     double-quoted values);
 *   - existing `process.env` values are NEVER overridden (real env wins);
 *   - missing/unreadable file is a no-op (never throws).
 */

import { readFileSync } from "node:fs";

/**
 * Parse the text of a `.env` file into a plain object. Pure; exported for tests.
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function parseEnv(text) {
  const out = {};
  if (typeof text !== "string") return out;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const withoutExport = line.startsWith("export ") ? line.slice(7).trim() : line;
    const eq = withoutExport.indexOf("=");
    if (eq <= 0) continue; // no key, or `=value`
    const key = withoutExport.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = withoutExport.slice(eq + 1).trim();
    // Strip an inline `# comment` from UNQUOTED values (quoted values keep `#`).
    if (value && value[0] !== '"' && value[0] !== "'") {
      const hash = value.indexOf(" #");
      if (hash !== -1) value = value.slice(0, hash).trim();
      else if (value.startsWith("#")) value = "";
    }
    value = stripQuotes(value);
    out[key] = value;
  }
  return out;
}

function stripQuotes(value) {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if (first === '"' && last === '"') {
      return value.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"');
    }
    if (first === "'" && last === "'") {
      return value.slice(1, -1);
    }
  }
  return value;
}

/**
 * Load `.env` (if present) into `target` without overriding existing keys.
 *
 * @param {{ path?: string, target?: Record<string, string|undefined> }} [opts]
 * @returns {string[]} the keys that were applied (for logging/tests).
 */
export function loadEnv({ path = ".env", target = process.env } = {}) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return []; // no .env — silent no-op
  }
  const parsed = parseEnv(text);
  const applied = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (target[key] === undefined) {
      target[key] = value;
      applied.push(key);
    }
  }
  return applied;
}
