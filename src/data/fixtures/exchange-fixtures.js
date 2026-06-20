/**
 * FIXTURE market data — NOT live. Deterministic recordings used for local
 * development and tests so the full stack runs without touching GGG.
 *
 * Keyed by `${have}>${want}`. Each value is an array of raw listings in the
 * observed GGG `result` shape (the provider assembles them into the keyed
 * object). Numbers are hand-authored to exercise the engine:
 *   - divine: positive spread but heavily gold-constrained (the brief's warning);
 *   - chaos:  negative round trip (a visible "spread" that is not profit);
 *   - vaal:   small profit, no gold-cost data (unknown-gold-cost warning).
 *
 * `indexed` is a placeholder; the fixture provider can freshen it at serve time.
 */

const STAMP = "2026-06-19T10:00:00Z";

function listing(id, account, offers) {
  return {
    id,
    listing: { indexed: STAMP, account: { name: account }, offers },
  };
}

function offer(haveCurrency, haveAmount, wantCurrency, wantAmount, stock) {
  return {
    exchange: { currency: haveCurrency, amount: haveAmount },
    item: { currency: wantCurrency, amount: wantAmount, stock },
  };
}

/**
 * Approximate top-of-book and depth per target, used to seed a believable
 * synthetic history (fixture mode only) so charts have shape on first load.
 * Clearly marked synthetic; never presented as live.
 */
export const NOMINAL = {
  divine: { entry: 200, exit: 215, depthEntry: 63, depthExit: 90 },
  chaos: { entry: 0.1111, exit: 0.1, depthEntry: 1700, depthExit: 5300 },
  vaal: { entry: 0.5, exit: 0.6, depthEntry: 60, depthExit: 500 },
};

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 997;
  return h / 997 * Math.PI * 2;
}

/** Deterministic gentle oscillation factor in [1-amp, 1+amp]. */
export function fixtureWobble(key, now, amp = 0.02) {
  return 1 + amp * Math.sin(now / 1_200_000 + hashStr(key));
}

/**
 * Build synthetic backfill history points over the last `points*stepMs`.
 *
 * Defaults span a full 6 hours (73 points at 5-minute steps) so the fixture
 * signal is honestly "ok" across every horizon selector (1/3/6h) instead of
 * silently falling under the coverage floor at 6h. Still flagged synthetic.
 * @returns {import("../../server/history-store.js").HistoryPoint[]}
 */
export function seedFixtureHistory({ shortlist, now, points = 73, stepMs = 5 * 60 * 1000 }) {
  const out = [];
  for (const target of shortlist) {
    const nom = NOMINAL[target];
    if (!nom) continue;
    for (let i = points - 1; i >= 0; i--) {
      const t = now - i * stepMs;
      const w = fixtureWobble(target, t) - 1; // centered oscillation
      const bestEntry = nom.entry * (1 + w);
      const bestExit = nom.exit * (1 - w);
      out.push({
        t,
        target,
        bestEntry,
        bestExit,
        spreadPct: ((bestExit - bestEntry) / bestEntry) * 100,
        depthEntry: nom.depthEntry,
        depthExit: nom.depthExit,
        synthetic: true,
      });
    }
  }
  return out;
}

export const EXCHANGE_FIXTURES = {
  // --- DIVINE -------------------------------------------------------------
  // entry: spend exalted, receive divine (~200-210 ex/divine)
  "exalted>divine": [
    listing("div-e1", "alpha", [offer("exalted", 200, "divine", 1, 3)]),
    listing("div-e2", "bravo", [offer("exalted", 205, "divine", 1, 10)]),
    listing("div-e3", "charlie", [offer("exalted", 210, "divine", 1, 50)]),
  ],
  // exit: spend divine, receive exalted (~208-215 ex/divine)
  "divine>exalted": [
    listing("div-x1", "delta", [offer("divine", 1, "exalted", 215, 5000)]),
    listing("div-x2", "echo", [offer("divine", 1, "exalted", 212, 4000)]),
    listing("div-x3", "foxtrot", [offer("divine", 1, "exalted", 208, 10000)]),
  ],

  // --- CHAOS --------------------------------------------------------------
  // entry: buy chaos cheap, exit: sell chaos cheaper -> negative round trip
  "exalted>chaos": [
    listing("cha-e1", "golf", [offer("exalted", 1, "chaos", 9, 900)]),
    listing("cha-e2", "hotel", [offer("exalted", 1, "chaos", 8, 800)]),
  ],
  "chaos>exalted": [
    listing("cha-x1", "india", [offer("chaos", 10, "exalted", 1, 200)]),
    listing("cha-x2", "juliet", [offer("chaos", 11, "exalted", 1, 300)]),
  ],

  // --- VAAL (no gold-cost data) ------------------------------------------
  // entry 0.5 ex/vaal, exit 0.6 ex/vaal -> small profit, gold unknown
  "exalted>vaal": [
    listing("vaal-e1", "kilo", [offer("exalted", 1, "vaal", 2, 60)]),
  ],
  "vaal>exalted": [
    listing("vaal-x1", "lima", [offer("vaal", 5, "exalted", 3, 300)]),
  ],

  // --- DIVINE anchor pairs (for the Divine anchor selector) ----------------
  // (divine<->exalted is intentionally left to the exalted-anchor fixtures; its
  // multi-level books have mismatched bundle sizes under the Divine anchor, so
  // the engine honestly reports it as non-executable — a faithful edge case.)
  //
  // chaos/vaal use MATCHED entry/exit bundle sizes so the round trip is fully
  // executable. Prices are in divine-per-target (small, by construction).
  // entry: 100 chaos for ~0.0526 divine; exit pays slightly more -> profit.
  "divine>chaos": [
    listing("dch-e1", "mike", [offer("divine", 0.0526, "chaos", 100, 50000)]),
  ],
  "chaos>divine": [
    listing("dch-x1", "november", [offer("chaos", 100, "divine", 0.054, 10)]),
  ],
  // entry: 50 vaal for ~0.1163 divine; exit pays slightly more -> profit.
  "divine>vaal": [
    listing("dvl-e1", "oscar", [offer("divine", 0.1163, "vaal", 50, 20000)]),
  ],
  "vaal>divine": [
    listing("dvl-x1", "papa", [offer("vaal", 50, "divine", 0.1205, 10)]),
  ],
};
