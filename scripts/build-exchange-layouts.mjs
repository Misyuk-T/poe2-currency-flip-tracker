#!/usr/bin/env node

import { readFile, rename, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import {
  LAYOUT_SOURCE_URLS,
  parseExchangeLayoutHtml,
  preserveKnownMetadataIds,
} from "../src/domain/exchange-layout-parse.js";

const TARGETS = [
  { game: "poe1", sourceUrl: LAYOUT_SOURCE_URLS.poe1, output: new URL("../src/data/exchange-layout-poe1.json", import.meta.url) },
  { game: "poe2", sourceUrl: LAYOUT_SOURCE_URLS.poe2, output: new URL("../src/data/exchange-layout-poe2.json", import.meta.url) },
];

const USER_AGENT = "poe-market-layout-refresh/1.0 (+https://github.com/Misyuk-T/poe2-currency-flip-tracker)";

function retryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);
}

function retryAfterMs(headers, now = Date.now()) {
  const value = headers?.get?.("retry-after");
  if (!value) return 0;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;

  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : 0;
}

export function isTransientFetchError(error) {
  return error?.transient === true
    || error?.name === "AbortError"
    || error?.name === "TimeoutError"
    || error instanceof TypeError;
}

export async function fetchHtml(url, {
  attempts = 4,
  baseDelayMs = 1_000,
  fetchImpl = globalThis.fetch,
  maxDelayMs = 30_000,
  onRetry = ({ attempt, delayMs, error }) => {
    console.warn(`${url}: attempt ${attempt} failed (${error.message}); retrying in ${delayMs}ms`);
  },
  sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  timeoutMs = 30_000,
} = {}) {
  if (!Number.isInteger(attempts) || attempts < 1) throw new TypeError("attempts must be a positive integer");

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: { "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        const error = new Error(`${url}: HTTP ${response.status}`);
        error.status = response.status;
        error.transient = retryableStatus(response.status);
        error.retryAfterMs = retryAfterMs(response.headers);
        throw error;
      }
      return await response.text();
    } catch (error) {
      error.attempts = attempt;
      if (!isTransientFetchError(error) || attempt === attempts) throw error;

      const exponentialDelayMs = baseDelayMs * (2 ** (attempt - 1));
      const delayMs = Math.min(maxDelayMs, Math.max(exponentialDelayMs, error.retryAfterMs || 0));
      onRetry({ attempt, delayMs, error, nextAttempt: attempt + 1 });
      await sleep(delayMs);
    }
  }

  throw new Error(`${url}: retry loop ended unexpectedly`);
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

function workflowWarning(message) {
  if (process.env.GITHUB_ACTIONS === "true") {
    const escaped = message.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
    console.log(`::warning title=Currency Exchange layout refresh::${escaped}`);
    return;
  }
  console.warn(message);
}

export async function runLayoutRefresh({
  allowStaleOnTransientFailure = process.env.LAYOUT_REFRESH_ALLOW_STALE_ON_TRANSIENT_FAILURE === "true",
  fetchHtmlImpl = fetchHtml,
  targets = TARGETS,
  warn = workflowWarning,
} = {}) {
  const staleTargets = [];

  for (const target of targets) {
    let html;
    try {
      html = await fetchHtmlImpl(target.sourceUrl);
    } catch (error) {
      if (!allowStaleOnTransientFailure || !isTransientFetchError(error)) throw error;

      staleTargets.push(target.game);
      warn(`${target.game}: keeping the checked-in snapshot because ${target.sourceUrl} failed after ${error.attempts || 1} attempts (${error.message})`);
      continue;
    }

    const previous = await existingSnapshot(target.output);
    const parsed = preserveKnownMetadataIds(parseExchangeLayoutHtml(html, target), previous);
    if (JSON.stringify(meaningful(previous)) === JSON.stringify(parsed)) {
      console.log(`${target.game}: unchanged (${parsed.itemCount} items, ${parsed.categories.length} categories)`);
      continue;
    }
    const next = { ...parsed, fetchedAt: new Date().toISOString() };
    await atomicWrite(target.output, next);
    console.log(`${target.game}: wrote ${parsed.itemCount} items, ${parsed.categories.length} categories`);
  }

  return { staleTargets };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runLayoutRefresh();
}
