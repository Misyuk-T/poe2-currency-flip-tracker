/**
 * Round-trip opportunity model and pure metric/sizing calculations.
 *
 * A round trip is A -> B -> A: spend anchor (A) to receive target (B) on the
 * entry leg, later spend that B to receive A on the exit leg. "Profit" is the
 * net anchor gained, but it is an ESTIMATE, never guaranteed arbitrage: the
 * exit leg may not fill, prices move while inventory is held, and gold is a
 * second scarce resource that constrains how much can actually be cycled.
 *
 * Sizing only ever recommends a quantity that BOTH legs can fully execute given
 * observed depth and bundle sizes (see reachableQuantities/canFullyFill). A
 * quantity the exit book cannot fully sell is never recommended.
 */

import { buildBook, bookDepth, reachableQuantities, canFullyFill } from "./order-book.js";
import { executableQuote } from "./executable-quote.js";
import { roundTripGold } from "./gold-costs.js";
import { computeHistorySignal, horizonAdjustment } from "./history-signal.js";

const EPS = 1e-9;

/**
 * @typedef {Object} UserConstraints
 * @property {number} currencyCapital   Anchor available to deploy on entry.
 * @property {number} goldAvailable
 * @property {number} goldReserve        Gold that must not be touched.
 * @property {number|null} [goldIncomePerHour]
 * @property {number} [horizonHours]
 * @property {number|null} [maxPositionTarget] Optional cap on position size (target units).
 */

/**
 * Build a ranked opportunity for a single target currency.
 *
 * @param {Object} args
 * @param {string} args.anchorId
 * @param {string} args.targetId
 * @param {string} [args.targetName]
 * @param {import("./offers.js").BookLevel[]} args.entryLevels  raw entry levels (have=anchor want=target)
 * @param {import("./offers.js").BookLevel[]} args.exitLevels   raw exit levels (have=target want=anchor)
 * @param {{ goldPerUnit: (id: string) => number|undefined }} args.goldRegistry
 * @param {UserConstraints} args.constraints
 * @param {import("../server/history-store.js").HistoryPoint[]} [args.history] real market points for this target
 * @param {number} [args.now]
 * @param {number|null} [args.maxListingAgeMs]
 */
export function buildOpportunity(args) {
  const {
    anchorId,
    targetId,
    targetName = targetId,
    entryLevels,
    exitLevels,
    goldRegistry,
    constraints,
    history = [],
    now = Date.now(),
    maxListingAgeMs = null,
  } = args;

  const entryBook = buildBook(entryLevels);
  const exitBook = buildBook(exitLevels);
  const depthEntry = bookDepth(entryBook);
  const depthExit = bookDepth(exitBook);
  const maxByDepth = Math.min(depthEntry, depthExit);

  const goldPerTarget = goldRegistry.goldPerUnit(targetId);
  const goldPerAnchor = goldRegistry.goldPerUnit(anchorId);
  const goldKnown = goldPerTarget != null && goldPerAnchor != null;

  // Validate the mode at the domain boundary too: the HTTP layer validates, but
  // direct callers must fail SAFE to strict (the conservative, gold-aware path),
  // never fail open to an unconstrained position.
  const goldMode =
    constraints.goldMode === "show" || constraints.goldMode === "ignore" ? constraints.goldMode : "strict";
  const goldConstrains = goldMode === "strict"; // only strict caps the position by gold

  // Strict ranks on a gold-resource metric, so it needs a verified gold cost.
  // show/ignore rank on capital efficiency (ROI), which needs no gold data, so a
  // missing gold cost must NOT suppress the row in those modes.
  const rankable = goldConstrains ? goldKnown : true;

  const goldBudget = Math.max(0, num(constraints.goldAvailable) - Math.max(0, num(constraints.goldReserve)));
  const capital = Math.max(0, num(constraints.currencyCapital));
  const positionCap =
    constraints.maxPositionTarget != null ? Math.max(0, Math.floor(constraints.maxPositionTarget)) : Infinity;
  const horizonHours = positiveOr(constraints.horizonHours, 3);

  const ctx = { entryBook, exitBook, goldPerTarget, goldPerAnchor, now, maxListingAgeMs };

  // Quantities the ENTRY book can fill exactly, bounded by depth + position cap,
  // that the EXIT book can ALSO fully execute (no partial exit from bundle-size
  // incompatibility). Ascending.
  const enumCap = Math.max(0, Math.floor(Math.min(maxByDepth, positionCap)));
  const executable = reachableQuantities(entryBook, enumCap).filter((q) => canFullyFill(exitBook, q));
  const maxExecutable = executable.length ? executable[executable.length - 1] : 0;

  const affordableCapital = (q) => evaluate(ctx, q).entryCost <= capital + EPS * (1 + capital);
  const affordableGold = (q) => {
    if (!goldConstrains) return true; // show/ignore modes never cap by gold
    const e = evaluate(ctx, q);
    if (e.totalGold == null) return true; // unknown gold cost is a warning, not a cap
    return e.totalGold <= goldBudget;
  };

  const maxByCapital = largestIn(executable, affordableCapital);
  const maxByGoldExec = goldConstrains ? largestIn(executable, affordableGold) : maxExecutable;
  const recommendedQty = largestIn(executable, (q) => affordableCapital(q) && affordableGold(q));

  const caps = { capital: maxByCapital, gold: maxByGoldExec, executable: maxExecutable };

  // Distinguish a genuine bundle mismatch (no executable size at ANY depth) from
  // a user position cap that merely truncated the reachable set below the first
  // executable size.
  let positionStarved = false;
  if (executable.length === 0 && Number.isFinite(positionCap) && positionCap < maxByDepth) {
    positionStarved = reachableQuantities(entryBook, Math.floor(maxByDepth)).some((q) =>
      canFullyFill(exitBook, q),
    );
  }

  const limitingResource = classifyLimit({
    recommendedQty,
    caps,
    positionCap,
    maxByDepth,
    maxExecutable,
    depthEntry,
    depthExit,
    candidatesEmpty: executable.length === 0,
    positionStarved,
    goldKnown: goldKnown && goldConstrains, // gold can only be the limit when it constrains sizing
  });

  const result = evaluate(ctx, recommendedQty);
  const warnings = collectWarnings({ result, goldKnown, depthEntry, depthExit, recommendedQty, maxExecutable });

  const entryVWAP = result.entryQuote.vwap;
  const exitVWAP = result.exitQuote.vwap;

  const historySignal = computeHistorySignal(history, { now, horizonHours });
  const horizonAdj = horizonAdjustment(historySignal);
  // Default score depends on gold mode: strict ranks on resource efficiency
  // (profit-per-100k-gold, requires a verified gold cost); show/ignore rank on
  // capital efficiency (ROI), which needs no gold data.
  const riskAdjustedScore = goldConstrains
    ? rankable && result.profitPer100kGold != null
      ? result.profitPer100kGold * horizonAdj
      : null
    : result.currencyROI != null
      ? result.currencyROI * horizonAdj
      : null;

  // Transparent, uncalibrated risk HEURISTIC (NOT a probability): higher = riskier.
  const riskScore = riskHeuristic({
    historyOk: historySignal.status === "ok",
    volatility: historySignal.spreadVolatility,
    meanSpread: historySignal.meanSpreadPct,
    ageMs: maxOrNull(result.entryQuote.oldestAgeMs, result.exitQuote.oldestAgeMs),
    maxListingAgeMs,
    depthMin: Math.min(depthEntry, depthExit),
  });

  // Candidate metrics for the explicit ranking modes (A2). All are heuristics /
  // current-book estimates, never forecasts.
  const ranking = {
    label: "heuristic",
    profit: result.grossProfit, // current-book gross (not a true expected value)
    roi: result.currencyROI,
    profitPer100kGold: result.profitPer100kGold,
    profitPerHour: result.grossProfit != null ? result.grossProfit / horizonHours : null,
    liquidity: maxExecutable,
    riskScore,
  };

  // A row is only a genuine recommendation when there is a VALID, sufficiently
  // covered history signal AND the underlying quote is not stale. A fresh live
  // install with < minSamples (or under-covered horizon) must NOT synthesize a
  // Buy recommendation from a single current spread; it stays non-actionable
  // (insufficient-history) with metrics still visible. Stale data is likewise
  // never actionable.
  const staleQuote = result.entryQuote.stale || result.exitQuote.stale;
  const historyOk = historySignal.status === "ok";
  const actionable =
    rankable &&
    recommendedQty > 0 &&
    result.grossProfit > 0 &&
    !warnings.includes("no-liquidity") &&
    historyOk &&
    !staleQuote;

  return {
    entryCurrency: anchorId,
    exitCurrency: anchorId, // round trip returns to anchor
    targetCurrency: targetId,
    targetName,
    anchorCurrency: anchorId,
    rankable,
    actionable,
    // headline executable prices (anchor per target)
    entryVWAP,
    exitVWAP,
    bestEntryPrice: entryBook[0]?.price ?? null,
    bestExitPrice: exitBook[0]?.price ?? null,
    grossSpreadPercent: entryVWAP && exitVWAP ? ((exitVWAP - entryVWAP) / entryVWAP) * 100 : null,
    quantity: result.heldTarget,
    grossProfit: result.grossProfit,
    // Current-book gross / mark-to-market estimate: what the round trip clears at
    // the CURRENT observed books, ignoring fill probability and price drift.
    currentBookGrossProfit: result.grossProfit,
    // Explicitly null: there is no probability/forecast model, so a true expected
    // value cannot be computed. Do NOT alias grossProfit here — that would imply a
    // certainty the engine does not have.
    expectedProfit: null,
    currencyROI: result.currencyROI,
    entryCost: result.entryCost,
    exitRevenue: result.exitRevenue,
    entryGold: result.entryGold,
    exitGold: result.exitGold,
    totalGold: result.totalGold,
    goldPerCycle: result.totalGold,
    profitPer100kGold: result.profitPer100kGold,
    riskAdjustedScore,
    goldMode,
    goldApplied: goldConstrains,
    ranking,
    horizonHours,
    historySignal,
    depth: { entry: depthEntry, exit: depthExit },
    sizing: {
      recommendedTarget: recommendedQty,
      maxByCapital: caps.capital,
      // Only a real gold cap (strict mode + known cost). In show/ignore gold does
      // not constrain sizing, so there is no gold cap to report.
      maxByGold: goldConstrains && goldKnown ? caps.gold : null,
      maxByDepth,
      maxFullyExecutable: maxExecutable,
      goldBudget,
    },
    summary: buildSummary({
      targetName,
      anchorId,
      result,
      recommendedQty,
      actionable,
      historySignal,
      staleQuote,
    }),
    freshness: {
      oldestIndexed: oldest(result.entryQuote.oldestIndexed, result.exitQuote.oldestIndexed),
      ageMs: maxOrNull(result.entryQuote.oldestAgeMs, result.exitQuote.oldestAgeMs),
      stale: result.entryQuote.stale || result.exitQuote.stale,
    },
    limitingResource,
    warnings,
    // Not fabricated: requires a probabilistic model that does not exist yet.
    fillProbability: { h1: null, h3: null, h6: null },
  };
}

/**
 * Evaluate a candidate position size (target units). Pure; used by both the
 * sizing search and final metric assembly.
 */
function evaluate(ctx, requestedTarget) {
  const { entryBook, exitBook, goldPerTarget, goldPerAnchor, now, maxListingAgeMs } = ctx;
  const entryQuote = executableQuote(entryBook, requestedTarget, { now, maxListingAgeMs });
  const heldTarget = entryQuote.filledTarget; // B actually acquired
  const exitQuote = executableQuote(exitBook, heldTarget, { now, maxListingAgeMs });

  const entryCost = entryQuote.anchorAmount; // A spent
  const exitRevenue = exitQuote.anchorAmount; // A received
  const grossProfit = exitRevenue - entryCost;

  const { entryGold, exitGold, totalGold } = roundTripGold({
    receivedTarget: heldTarget,
    receivedAnchorOnExit: exitRevenue,
    goldPerTarget,
    goldPerAnchor,
  });

  return {
    requestedTarget,
    heldTarget,
    entryQuote,
    exitQuote,
    entryCost,
    exitRevenue,
    grossProfit,
    currencyROI: entryCost > 0 ? grossProfit / entryCost : null,
    entryGold,
    exitGold,
    totalGold,
    profitPer100kGold: totalGold && totalGold > 0 ? (grossProfit / totalGold) * 100000 : null,
  };
}

/** Largest value in the ascending `list` satisfying `pred` (0 if none). */
function largestIn(list, pred) {
  for (let i = list.length - 1; i >= 0; i--) {
    if (pred(list[i])) return list[i];
  }
  return 0;
}

function classifyLimit({
  recommendedQty,
  caps,
  positionCap,
  maxByDepth,
  maxExecutable,
  depthEntry,
  depthExit,
  candidatesEmpty,
  positionStarved,
  goldKnown,
}) {
  if (recommendedQty <= 0) {
    if (depthEntry <= 0 || depthExit <= 0) return "liquidity";
    if (positionStarved) return "position"; // a higher position cap would have an executable size
    if (candidatesEmpty) return "bundle-mismatch"; // entry can buy, exit can't fully sell any reachable qty
    if (caps.capital <= 0) return "capital";
    if (goldKnown && caps.gold <= 0) return "gold";
    return "liquidity";
  }

  // Capital/gold caps are within the executable ceiling; they only truly BIND
  // when they fall strictly below it.
  const capitalBinds = caps.capital < maxExecutable && caps.capital <= recommendedQty + EPS;
  const goldBinds = goldKnown && caps.gold < maxExecutable && caps.gold <= recommendedQty + EPS;

  if (goldBinds && (!capitalBinds || caps.gold <= caps.capital)) return "gold";
  if (capitalBinds) return "capital";

  // Otherwise the executable ceiling itself binds.
  if (Number.isFinite(positionCap) && positionCap <= maxByDepth && positionCap <= recommendedQty + EPS) {
    return "position";
  }
  // Exit could not fully execute the full depth -> exit liquidity/bundle bound.
  if (maxExecutable < maxByDepth) return "liquidity-exit";
  return depthExit <= depthEntry ? "liquidity-exit" : "liquidity-entry";
}

function collectWarnings({ result, goldKnown, depthEntry, depthExit, recommendedQty, maxExecutable }) {
  const w = [];
  if (depthEntry <= 0 || depthExit <= 0) w.push("no-liquidity");
  if (!goldKnown) w.push("unknown-gold-cost");
  if (recommendedQty > 0 && result.exitQuote.partial) w.push("partial-exit");
  if (recommendedQty > 0 && result.entryQuote.partial) w.push("partial-entry");
  // Entry can buy, but the exit book cannot fully sell ANY reachable size.
  if (depthEntry > 0 && depthExit > 0 && maxExecutable <= 0) w.push("exit-not-executable");
  if (result.entryQuote.stale || result.exitQuote.stale) w.push("stale-data");
  if (recommendedQty > 0 && result.grossProfit < 0) w.push("negative-profit");
  if (recommendedQty <= 0) w.push("no-feasible-position");
  return w;
}

function buildSummary({ targetName, anchorId, result, recommendedQty, actionable, historySignal, staleQuote }) {
  if (recommendedQty <= 0) {
    return {
      actionable: false,
      text: `No fully-executable ${targetName} round trip at your constraints.`,
    };
  }

  // Current-book metrics are always carried so the UI can show them in
  // non-actionable details. Only the TEXT changes: it must never instruct a Buy
  // unless the row is genuinely actionable.
  const metrics = {
    quantity: result.heldTarget,
    entryCost: result.entryCost,
    exitRevenue: result.exitRevenue,
    totalGold: result.totalGold,
    grossProfit: result.grossProfit,
    anchor: anchorId,
  };

  if (actionable) {
    const text =
      `Buy ${fmt(result.heldTarget)} ${targetName} for ~${fmt(result.entryCost)} ${anchorId}, ` +
      `estimated exit ~${fmt(result.exitRevenue)} ${anchorId}` +
      (result.totalGold != null ? `, gold ${fmt(result.totalGold)}` : `, gold unknown`) +
      `, estimated profit ${signed(result.grossProfit)} ${anchorId}.`;
    return { actionable: true, ...metrics, text };
  }

  // Non-actionable but a position exists: describe WHY, show the current-book
  // gross as an estimate, and explicitly disclaim that this is not a buy call.
  let reason;
  if (historySignal && historySignal.status !== "ok") {
    reason =
      `Insufficient verified history over ${fmt(historySignal.horizonHours)}h ` +
      `(${historySignal.samples} sample${historySignal.samples === 1 ? "" : "s"}` +
      `, ${fmt((historySignal.coverageFraction ?? 0) * 100)}% horizon coverage)`;
  } else if (staleQuote) {
    reason = "Stale market data";
  } else if (result.grossProfit <= 0) {
    reason = "No positive current-book spread";
  } else {
    reason = "Not actionable at your constraints";
  }
  const text =
    `${reason} for ${targetName} — not a buy recommendation. ` +
    `Current-book estimate only: ${fmt(result.heldTarget)} ${targetName} ` +
    `for ~${fmt(result.entryCost)} ${anchorId}, exit ~${fmt(result.exitRevenue)} ${anchorId}, ` +
    `gross ${signed(result.grossProfit)} ${anchorId}.`;
  return { actionable: false, ...metrics, text };
}

function fmt(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: Math.abs(n) >= 100 ? 0 : 2 }).format(n);
}
function signed(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  return (n > 0 ? "+" : "") + fmt(n);
}

/**
 * Uncalibrated risk heuristic in [0,1] (higher = riskier). Combines spread
 * volatility, data staleness, thin liquidity, and missing history. This is a
 * transparent weighting, NOT a calibrated probability.
 */
function riskHeuristic({ historyOk, volatility, meanSpread, ageMs, maxListingAgeMs, depthMin }) {
  // A non-finite volatility (or no usable mean spread) is treated as UNKNOWN
  // risk (0.5), never as zero risk — an overflow must not make a row look safe.
  const vol =
    meanSpread != null && Math.abs(meanSpread) > EPS && Number.isFinite(volatility)
      ? clamp01(volatility / Math.abs(meanSpread))
      : 0.5;
  const stale = maxListingAgeMs && ageMs != null ? clamp01(ageMs / maxListingAgeMs) : 0;
  const thin = clamp01(1 / (1 + Math.log10(1 + Math.max(0, depthMin || 0))));
  const hist = historyOk ? 0 : 0.5;
  return clamp01(0.35 * vol + 0.25 * stale + 0.2 * thin + 0.2 * hist);
}

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function positiveOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function oldest(a, b) {
  if (!a) return b ?? null;
  if (!b) return a;
  return a < b ? a : b;
}

function maxOrNull(a, b) {
  const vals = [a, b].filter((x) => x != null);
  return vals.length ? Math.max(...vals) : null;
}
