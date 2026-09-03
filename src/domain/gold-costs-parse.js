/**
 * ONE implementation of "poe2db Currency Exchange page -> gold cost per item id".
 *
 * This lived inline in scripts/build-gold-costs.mjs, whose only job was to
 * regenerate src/data/gold-costs-poe2.js. Phase C adds a second caller — the
 * runtime job that writes the same numbers to the `gold_costs` table
 * (apps/web/lib/data-refresh.js) — and two copies of a scrape-and-match would
 * mean two different gold tables, one in git and one in Postgres, disagreeing
 * about a number users act on. So the parse and the name match live here, pure
 * and synchronous: no fetch, no filesystem, no clock.
 *
 * The script keeps its own I/O, its generated-file envelope and its logging, so
 * the committed file stays byte-identical (asserted by the round-trip in
 * test/gold-costs-parse.test.js).
 *
 * HONESTY RULE, and the reason the matcher is as strict as it is: an item whose
 * display name does not resolve to EXACTLY ONE trade catalog id is omitted, not
 * guessed. A missing gold cost is surfaced as a coverage gap and the target is
 * marked unrankable; an invented one would be a lie about money.
 */

/** The page both the build script and the runtime job read. */
export const GOLD_SOURCE_URL = "https://poe2db.tw/us/Currency_Exchange";

/**
 * Coverage floor. 651 items matched on 2026-07-25; anything under 500 means the
 * page shrank, changed shape, or served an error — none of which may be allowed
 * to overwrite a working table.
 */
export const MIN_MATCHED = 500;

/**
 * Ids whose absence proves the match itself broke rather than the page merely
 * changing. Without the three anchor currencies nothing is rankable anyway.
 */
export const REQUIRED_IDS = Object.freeze(["exalted", "divine", "chaos"]);

// `data-hover="?s=Data%5CBaseItemTypes%2FMetadata%2FItems%2F...">Name</a><span>123</span>` —
// the second (text) <a> for each item is immediately followed by its gold <span>;
// the first (image) <a> is followed by an <img>, so this pattern only matches once per item.
const ITEM_RE = /data-hover="\?s=([^"]+)"\s+href="[^"]*">([^<]+)<\/a><span>(\d+)<\/span>/g;

/** Exact-name join key. Trimmed and lowercased, nothing else — see the honesty rule. */
export function goldNameKey(name) {
  return String(name ?? "").trim().toLowerCase();
}

function decodeEntities(value) {
  return String(value)
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&")
    .trim();
}

/**
 * Scrape one Currency Exchange page into `{ metadataPath, name, goldPerUnit }`.
 *
 * Deduped on the (metadata, name, gold) triple exactly as the script did: the
 * page renders the same item twice in the "Popular" view and in its own section,
 * and both renderings agree.
 *
 * @returns {{ metadataPath: string|null, name: string, goldPerUnit: number }[]}
 */
export function parseGoldCostsHtml(html) {
  const scraped = [];
  const seen = new Set();
  for (const match of String(html ?? "").matchAll(ITEM_RE)) {
    const [, rawHover, rawName, rawGold] = match;
    let decoded = rawHover;
    try {
      decoded = decodeURIComponent(rawHover);
    } catch {
      // A malformed escape on a third-party page must not abort the whole parse.
    }
    const metaIdx = decoded.indexOf("Metadata/");
    const metadataPath = metaIdx === -1 ? null : decoded.slice(metaIdx);
    const name = decodeEntities(rawName);
    const goldPerUnit = Number(rawGold);
    const key = `${metadataPath}|${name}|${goldPerUnit}`;
    if (seen.has(key)) continue;
    seen.add(key);
    scraped.push({ metadataPath, name, goldPerUnit });
  }
  return scraped;
}

/**
 * Join scraped items to trade catalog short ids by EXACT display name.
 *
 * A name that maps to two catalog ids is ambiguous and is dropped, not
 * arbitrated — the same rule the build script has always applied. Output is
 * sorted by item id so the generated file and the upserted batch are stable.
 *
 * @param {{ name: string, goldPerUnit: number }[]} scraped
 * @param {{ items?: { id: string, name: string }[] }} catalog
 * @returns {{ matched: [string, string, number][], unmatched: string[] }}
 *   `matched` entries are `[itemId, displayName, goldPerUnit]`.
 */
export function matchGoldCosts(scraped, catalog) {
  const nameToIds = new Map();
  for (const item of catalog?.items ?? []) {
    const key = goldNameKey(item?.name);
    if (!key) continue;
    if (!nameToIds.has(key)) nameToIds.set(key, [item.id]);
    else nameToIds.get(key).push(item.id);
  }

  const matched = [];
  const unmatched = [];
  for (const item of scraped ?? []) {
    const ids = nameToIds.get(goldNameKey(item.name));
    if (ids && ids.length === 1) matched.push([ids[0], item.name, item.goldPerUnit]);
    else unmatched.push(item.name);
  }
  matched.sort((a, b) => a[0].localeCompare(b[0]));
  return { matched, unmatched };
}

/**
 * The coverage floor, as a decision rather than a throw, so the runtime job can
 * record it and keep the previous rows while the script can still abort.
 *
 * @returns {{ ok: boolean, reason: string|null, missingRequired: string[] }}
 */
export function checkGoldCoverage(matched, { minMatched = MIN_MATCHED, requiredIds = REQUIRED_IDS } = {}) {
  const rows = matched ?? [];
  if (rows.length < minMatched) {
    return { ok: false, reason: `only ${rows.length} matched items (< ${minMatched})`, missingRequired: [] };
  }
  const ids = new Set(rows.map((row) => row[0]));
  const missingRequired = requiredIds.filter((id) => !ids.has(id));
  if (missingRequired.length) {
    return { ok: false, reason: `required ids missing: ${missingRequired.join(", ")}`, missingRequired };
  }
  return { ok: true, reason: null, missingRequired: [] };
}

/**
 * Below this many CHANGED items the ratio rule is not applied at all: with a
 * handful of changes it is noise, and a false refusal is self-perpetuating (a
 * refused batch never advances the baseline). See checkGoldVolatility.
 */
export const MIN_CHANGED_SAMPLE = 20;

/**
 * Absolute ceiling on big moves, whatever the ratio says. 50 items rescaling by
 * more than half is a broken page even on a day the page also changed thousands
 * of other values.
 */
export const MAX_BIG_MOVES = 50;

/**
 * The volatility guard (docs/DYNAMIC-DATA-PLAN-2026-09.md, Phase C).
 *
 * Gold is a number users act on, so a page that suddenly rescales its whole
 * table — a units change, a different column, a half-rendered response — must
 * not be allowed to apply. The rule, stated exactly, over the items present in
 * BOTH the baseline and the new batch whose value CHANGED at all:
 *
 *   1. Fewer than MIN_CHANGED_SAMPLE changed  -> ALLOW. The ratio is meaningless
 *      at that size, and refusing here is what freezes the table (see below).
 *   2. Otherwise, more than 5% of the changed items moved by more than 50%
 *      (relative to the baseline value) -> REFUSE the whole batch.
 *   3. Regardless of ratio, more than MAX_BIG_MOVES big moves -> REFUSE. A
 *      rescale large enough in absolute terms is a broken page even when the
 *      page also changed thousands of other values, which is the one case rule
 *      2's denominator would wave through.
 *
 * The denominator in rule 2 is deliberately "items that changed", not "all
 * items": a normal patch touches a handful of fees, and measuring big moves
 * against the full 651 would let a total rescale of 30 items slip through as
 * 4.6%.
 *
 * Rule 1 exists because the guard's failure mode is WORSE than the thing it
 * guards against. Without it, ONE legitimately-changed item that doubles is
 * 1/1 = 100% > 5%, so the batch is refused — and because a refused batch never
 * advances the baseline, every later run compares against the same stale
 * numbers and refuses identically. Gold would freeze at the committed July
 * table forever with nothing but a cron trace as the signal. A league patch
 * retuning a few fees (very likely at a launch) is exactly that shape. Below
 * the sample floor the coverage floor and rule 3 are the gates.
 *
 * Other consequences worth knowing rather than discovering:
 *   - First run (no baseline rows at all) has nothing to compare against, so it
 *     is ALWAYS accepted — the coverage floor is the only gate there. The
 *     runtime job therefore seeds its baseline from the committed file, so the
 *     first DB write is still compared against the last known-good table.
 *   - An item present in only one side is not a "change"; it is coverage, and
 *     the coverage floor already governs that.
 *
 * @param {[string, string, number][]} matched
 * @param {Map<string, number>|Record<string, number>} baseline itemId -> gold per unit
 * @returns {{ ok: boolean, compared: number, changed: number, bigMoves: number,
 *             ratio: number, examples: {itemId:string, from:number, to:number}[],
 *             reason: string|null }}
 */
export function checkGoldVolatility(matched, baseline, {
  maxBigMoveRatio = 0.05,
  bigMoveFactor = 0.5,
  minChangedSample = MIN_CHANGED_SAMPLE,
  maxBigMoves = MAX_BIG_MOVES,
} = {}) {
  const previous = baseline instanceof Map ? baseline : new Map(Object.entries(baseline ?? {}));
  let compared = 0;
  let changed = 0;
  let bigMoves = 0;
  const examples = [];
  for (const [itemId, , goldPerUnit] of matched ?? []) {
    const before = previous.get(itemId);
    if (!Number.isFinite(before) || !Number.isFinite(goldPerUnit)) continue;
    compared += 1;
    if (before === goldPerUnit) continue;
    changed += 1;
    // A baseline of 0 has no meaningful relative move; any change from it is
    // treated as big, because it cannot be shown to be small.
    const moved = before === 0 ? true : Math.abs(goldPerUnit - before) / Math.abs(before) > bigMoveFactor;
    if (!moved) continue;
    bigMoves += 1;
    if (examples.length < 5) examples.push({ itemId, from: before, to: goldPerUnit });
  }
  const ratio = changed ? bigMoves / changed : 0;
  // Rule 3 first: an absolute cap is a statement about the page being broken and
  // does not care how many other values moved.
  const overCap = bigMoves > maxBigMoves;
  // Rule 1: too small a sample for the ratio to mean anything.
  const tooFewToJudge = changed < minChangedSample;
  const overRatio = !tooFewToJudge && ratio > maxBigMoveRatio;
  const ok = !overCap && !overRatio;
  const reason = overCap
    ? `${bigMoves} items moved by more than ${bigMoveFactor * 100}% (absolute cap is ${maxBigMoves})`
    : overRatio
      ? `${bigMoves}/${changed} changed items moved by more than ${bigMoveFactor * 100}% (${(ratio * 100).toFixed(1)}% > ${maxBigMoveRatio * 100}%)`
      : null;
  return { ok, compared, changed, bigMoves, ratio, examples, reason };
}
