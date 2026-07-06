#!/usr/bin/env node
/**
 * Refetch the PoE2 item catalog from GGG and download icons locally.
 *
 * - Rewrites src/data/catalog-poe2.json (item metadata: ids/names/categories —
 *   facts, committed). Written atomically only after schema validation.
 * - Downloads icon art into apps/web/public/icons/<id>.png (gitignored; GGG-owned,
 *   NOT committed). Skip with --no-icons.
 *
 * Network-gated; run manually:  node scripts/build-catalog.mjs [--no-icons]
 *
 * Attribution: item names and icon art are © Grinding Gear Games. Non-commercial
 * fan use; seek written permission before any commercial use.
 */

import { writeFile, rename, mkdir, unlink, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, sep } from "node:path";

const BASE = "https://www.pathofexile.com";
const STATIC_URL = `${BASE}/api/trade2/data/static`;
const UA = process.env.USER_AGENT ?? "poe2-currency-flip-tracker/0.1 (catalog build; non-commercial)";
const CATALOG_PATH = fileURLToPath(new URL("../src/data/catalog-poe2.json", import.meta.url));
const ICON_DIR = fileURLToPath(new URL("../apps/web/public/icons/", import.meta.url));
const noIcons = process.argv.includes("--no-icons");
const missingIconsOnly = process.argv.includes("--missing-icons");

// Real GGG ids include a small number of accented letters (e.g. Mjö…); allow
// Unicode letters/numbers and dashes, but never path separators or punctuation.
const ID_RE = /^[\p{L}\p{N}][\p{L}\p{N}-]{0,63}$/u;
const MIN_ITEMS = 100; // sanity floor — guards against a truncated/changed response
const REQUIRED_IDS = ["exalted", "divine", "chaos"];
const ALLOWED_HOSTS = new Set(["www.pathofexile.com", "web.poecdn.com"]);
const MAX_ICON_BYTES = 512 * 1024;

async function main() {
  console.log(`Fetching ${STATIC_URL} ...`);
  const res = await fetch(STATIC_URL, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`static endpoint returned ${res.status}`);
  const data = await res.json();
  if (!data || !Array.isArray(data.result)) throw new Error("unexpected static schema: `result` is not an array");

  const items = [];
  const seen = new Set();
  let unknownCategories = 0;
  for (const cat of data.result) {
    for (const e of cat?.entries ?? []) {
      if (!e?.id || !e?.text || seen.has(e.id)) continue;
      seen.add(e.id);
      const image = e.image ? (e.image.startsWith("http") ? e.image : BASE + e.image) : null;
      const category = cat.label ?? cat.id ?? "Unknown";
      if (category === "Unknown") unknownCategories++;
      items.push({ id: e.id, name: e.text, category, image });
    }
  }

  // Validate before we overwrite the committed catalog (never clobber with junk).
  if (items.length < MIN_ITEMS) throw new Error(`only ${items.length} items (< ${MIN_ITEMS}); refusing to overwrite`);
  for (const id of REQUIRED_IDS) {
    if (!seen.has(id)) throw new Error(`required id "${id}" missing; refusing to overwrite`);
  }

  const out = {
    game: "poe2",
    source: "GGG api/trade2/data/static",
    fetchedAt: new Date().toISOString().slice(0, 10),
    note: "Item metadata (ids/names/categories) only. Icon art is GGG-owned; downloaded locally, not committed.",
    items,
  };
  const tmp = `${CATALOG_PATH}.tmp-${process.pid}`;
  try {
    await writeFile(tmp, JSON.stringify(out));
    await rename(tmp, CATALOG_PATH); // atomic replace
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
  console.log(`Wrote ${items.length} items -> ${CATALOG_PATH}`);
  if (unknownCategories) console.warn(`WARNING: ${unknownCategories} items have an Unknown category`);

  if (noIcons) return;
  await mkdir(ICON_DIR, { recursive: true });
  let ok = 0;
  let fail = 0;
  let skip = 0;
  let existing = 0;
  for (const it of items) {
    if (!it.image) continue;
    // Path-traversal guard: only safe ids, and the resolved file must stay inside ICON_DIR.
    if (!ID_RE.test(it.id)) {
      skip++;
      continue;
    }
    const dest = resolve(ICON_DIR, `${it.id}.png`);
    if (!dest.startsWith(resolve(ICON_DIR) + sep)) {
      skip++;
      continue;
    }
    if (missingIconsOnly) {
      try {
        await access(dest);
        existing++;
        continue;
      } catch {
        // Missing: download below.
      }
    }
    // SSRF guard: only fetch from known GGG/CDN hosts over https.
    let host;
    try {
      const u = new URL(it.image);
      host = u.protocol === "https:" ? u.hostname : null;
    } catch {
      host = null;
    }
    if (!host || !ALLOWED_HOSTS.has(host)) {
      skip++;
      continue;
    }
    try {
      const r = await fetch(it.image, {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(10_000),
      });
      if (!r.ok) {
        fail++;
        continue;
      }
      const buf = Buffer.from(await r.arrayBuffer());
      const contentType = r.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
      const isPng = buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      if (contentType !== "image/png" || !isPng || buf.length > MAX_ICON_BYTES) {
        skip++;
        continue;
      }
      const iconTmp = `${dest}.tmp-${process.pid}`;
      try {
        await writeFile(iconTmp, buf);
        await rename(iconTmp, dest);
      } catch (err) {
        await unlink(iconTmp).catch(() => {});
        throw err;
      }
      ok++;
    } catch {
      fail++;
    }
    await new Promise((r) => setTimeout(r, 40)); // be polite to the CDN
  }
  console.log(`Icons: ${ok} downloaded, ${existing} existing, ${fail} failed, ${skip} skipped -> ${ICON_DIR}`);
  console.log("Attribution: item names + icon art © Grinding Gear Games (non-commercial fan use).");
}

main().catch((e) => {
  console.error("build-catalog failed:", e.message);
  process.exit(1);
});
