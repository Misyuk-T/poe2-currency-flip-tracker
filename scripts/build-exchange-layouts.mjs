#!/usr/bin/env node

import { readFile, rename, writeFile } from "node:fs/promises";

import { parseExchangeLayoutHtml, preserveKnownMetadataIds } from "./lib/exchange-layout-parser.mjs";

const TARGETS = [
  { game: "poe1", sourceUrl: "https://poedb.tw/us/Currency_Exchange", output: new URL("../src/data/exchange-layout-poe1.json", import.meta.url) },
  { game: "poe2", sourceUrl: "https://poe2db.tw/us/Currency_Exchange", output: new URL("../src/data/exchange-layout-poe2.json", import.meta.url) },
];

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: { "user-agent": "poe-market-layout-refresh/1.0 (+https://github.com/Misyuk-T/poe2-currency-flip-tracker)" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
}

async function existingSnapshot(url) {
  try {
    return JSON.parse(await readFile(url, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function meaningful(snapshot) {
  if (!snapshot) return null;
  const { fetchedAt: _ignored, ...rest } = snapshot;
  return rest;
}

async function atomicWrite(url, data) {
  const temporary = new URL(`${url.pathname}.tmp`, url);
  await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(temporary, url);
}

for (const target of TARGETS) {
  const previous = await existingSnapshot(target.output);
  const parsed = preserveKnownMetadataIds(
    parseExchangeLayoutHtml(await fetchHtml(target.sourceUrl), target),
    previous,
  );
  if (JSON.stringify(meaningful(previous)) === JSON.stringify(parsed)) {
    console.log(`${target.game}: unchanged (${parsed.itemCount} items, ${parsed.categories.length} categories)`);
    continue;
  }
  const next = { ...parsed, fetchedAt: new Date().toISOString() };
  await atomicWrite(target.output, next);
  console.log(`${target.game}: wrote ${parsed.itemCount} items, ${parsed.categories.length} categories`);
}
