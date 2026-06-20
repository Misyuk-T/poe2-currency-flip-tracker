/**
 * Server entry point. Wires config -> gold registry -> provider -> app, starts
 * an HTTP server and a background poller at the configured interval.
 */

import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

import { loadEnv } from "./load-env.js";
import { loadConfig } from "./config.js";
import { createApp } from "./app.js";
import { catalogTargets } from "./snapshot.js";
import { createStorage } from "../storage/storage-provider.js";
import { createFixtureProvider } from "../providers/fixture-provider.js";
import { createGggExchangeProvider } from "../providers/ggg-exchange-provider.js";
import { createGoldRegistry, validateShortlistCoverage } from "../domain/gold-costs.js";
import { POE2_GOLD_COSTS } from "../data/gold-costs-poe2.js";
import { seedFixtureHistory } from "../data/fixtures/exchange-fixtures.js";
import { loadCatalog } from "../domain/catalog.js";
import { createTieredScheduler, marketCandidates, estimateRequests } from "./tiered-scheduler.js";

// Load .env (if present) before reading config. Real env vars always win.
loadEnv({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });

const HISTORY_DIR = fileURLToPath(new URL("../../.data/", import.meta.url));

async function main() {
  const config = loadConfig();
  const goldRegistry = createGoldRegistry(POE2_GOLD_COSTS, { game: config.poeGame });

  // Coverage gaps are surfaced loudly, never silently guessed.
  const coverage = validateShortlistCoverage(goldRegistry, {
    anchorCurrency: config.anchorCurrency,
    shortlist: config.shortlist,
  });
  if (!coverage.anchorCovered) {
    log(`WARNING: anchor "${config.anchorCurrency}" has no gold cost — exit gold cannot be computed.`);
  }
  // Every configured anchor needs a gold cost (it is also a target for others).
  for (const anchor of config.anchors) {
    if (!goldRegistry.has(anchor)) {
      log(`WARNING: anchor "${anchor}" has no gold cost — round trips under it are UNRANKABLE in strict gold mode.`);
    }
  }
  if (coverage.missing.length) {
    log(
      `WARNING: no verified gold cost for: ${coverage.missing.join(", ")}. ` +
        `These targets are marked UNRANKABLE (never guessed). Add rows to data/gold-costs-poe2.js to rank them.`,
    );
  }

  // Provider: live is env-gated; fixture mode gets gentle motion for charts.
  const provider =
    config.providerMode === "live"
      ? createGggExchangeProvider(config)
      : createFixtureProvider(config, { wobble: true });

  // History is isolated per provider mode + game/realm/league/anchor so fixture
  // and live data can never share a file or contaminate each other.
  // Durable storage behind the StorageProvider seam. Isolated by mode +
  // game/realm/league/anchor so Exalted/Divine and fixture/live never mix.
  if (config.storageMode === "supabase" && !config.databaseUrl) {
    log("WARNING: STORAGE=supabase but DATABASE_URL is unset — falling back to local JSONL storage.");
  }
  const scope = { mode: provider.mode, game: config.poeGame, realm: config.poeRealm, league: config.league };
  const storage = createStorage(config, { dir: HISTORY_DIR });
  await storage.init(scope, config.anchors);
  log(`storage: ${storage.mode}`);
  // Synthetic backfill (fixture-only, flagged synthetic) for the default anchor
  // so charts have shape; other anchors fill from polling.
  if (provider.mode === "fixture" && Object.keys(storage.series(config.anchorCurrency).all()).length === 0) {
    storage.seedSynthetic(config.anchorCurrency, seedFixtureHistory({ shortlist: config.shortlist, now: Date.now() }));
  }

  // Structured one-line JSON logs for each refresh cycle (no secrets).
  const logger = (rec) => process.stdout.write(JSON.stringify({ t: new Date().toISOString(), ...rec }) + "\n");
  const catalog = await loadCatalog();
  if (!catalog.items?.length) {
    log("WARNING: item catalog is empty/unreadable — /api/catalog will be empty and rows fall back to a generic icon. Run `node scripts/build-catalog.mjs`.");
  } else {
    log(`catalog: ${catalog.items.length} items`);
  }
  const candidates = marketCandidates(catalog, {
    categories: config.marketCategories,
    exclude: config.anchors,
  });
  const scheduler =
    provider.mode === "live" && config.schedulerEnabled
      ? createTieredScheduler({
          hotTargets: config.shortlist,
          candidates,
          warmSize: config.warmBatchSize,
          coldSize: config.coldBatchSize,
          warmEveryMs: config.warmIntervalMs,
          coldEveryMs: config.coldIntervalMs,
        })
      : null;
  if (scheduler) {
    const first = scheduler.status();
    const preview = scheduler.next(); // planning is side-effect-free until commit
    const firstRequestBudget = config.anchors.reduce(
      (sum, anchor) =>
        sum + estimateRequests(catalogTargets(anchor, preview.targets, config.anchors).length, 1, config.batchSize),
      0,
    );
    log(
      `scheduler: ${first.universeSize} candidates; first-cycle budget ${firstRequestBudget} requests`,
    );
  }
  const app = createApp(config, { provider, goldRegistry, storage, logger, catalog, scheduler });

  const server = createServer(app.handler);
  // Request timeouts so a slow/hung client can't tie up a connection. Reads are
  // pure compute (no provider call on the request path), so these are generous.
  server.requestTimeout = 15_000;
  server.headersTimeout = 16_000;
  server.listen(config.port, () => {
    log(
      `listening on http://localhost:${config.port}  (provider=${provider.mode}, league="${config.league}")`,
    );
    if (provider.mode === "fixture") {
      log("FIXTURE MODE: data is offline/synthetic. Set PROVIDER_MODE=live for the experimental GGG source.");
    }
  });

  // Warm the snapshot, then poll in the background with jitter so many
  // instances don't align their provider hits. The scheduler is the ONLY thing
  // that drives provider refreshes (the circuit breaker lives inside refresh()).
  app.refresh();
  let timer = null;
  const scheduleNext = () => {
    const jitter = (Math.random() * 2 - 1) * 0.1 * config.pollIntervalMs; // ±10%
    const wait = Math.max(1000, config.pollIntervalMs + jitter);
    timer = setTimeout(async () => {
      try {
        await app.refresh();
      } finally {
        scheduleNext();
      }
    }, wait);
    timer.unref?.();
  };
  scheduleNext();

  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, async () => {
      if (timer) clearTimeout(timer);
      await storage.close().catch(() => {});
      server.close(() => process.exit(0));
    });
  }
}

function log(msg) {
  process.stdout.write(`[poe2-flip] ${msg}\n`);
}

main().catch((err) => {
  process.stderr.write(`[poe2-flip] fatal: ${err.stack ?? err}\n`);
  process.exit(1);
});
