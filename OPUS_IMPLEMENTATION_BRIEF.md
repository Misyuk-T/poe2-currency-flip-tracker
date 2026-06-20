# Implementation brief for Claude Opus 4.8

## Mission

Turn the current static proof of concept into the first honest, testable backend-driven MVP of a Path of Exile 2 currency opportunity tracker.

The product is **not** another page that republishes raw prices. Raw prices are already free elsewhere. Its purpose is to answer:

> Given my currency capital, available gold, current executable market depth, and a horizon of roughly 1–6 hours, what can I buy now that has a plausible chance of being sold later for a useful risk-adjusted profit?

The user eventually wants to share this with a small PoE/PoE2 audience (for example through Reddit), first as a useful free product and potentially later with a small subscription around USD 5. Do not build billing or authentication now. The immediate goal is a technically credible data and calculation foundation that can later support that product.

You are the implementation agent. Inspect the repository, improve the code, run appropriate checks, and leave a concise implementation report. Codex will review your work afterwards.

## Working rules

- Work autonomously within this repository.
- Do not commit, push, publish, deploy, send messages, or create external accounts.
- Preserve unrelated user changes.
- Do not use public CORS proxies.
- Do not fabricate live data, gold formulas, API stability, or forecast accuracy.
- Prefer small, understandable modules and deterministic pure functions for market calculations.
- Keep source/provider boundaries explicit because the live GGG endpoint is undocumented and may need to be replaced.
- If a live endpoint cannot be called safely in tests, use recorded minimal fixtures and clearly label them as fixtures.
- Do not silently fall back to sample opportunities in the production path. A data failure must be visible as a data failure.
- Document assumptions and unresolved legal/API questions in the README.

## Repository state

The repository currently contains only:

- `index.html`
- `styles.css`
- `app.js`
- a minimal `README.md`

It is a static browser application. `app.js` currently:

- hardcodes league `Runes of Aldur HC`;
- refreshes every 300 seconds;
- races poe.ninja against GGG trade calls;
- attempts to work around CORS using `allorigins.win` and `corsproxy.io`;
- assumes `exchange.result` is an array and calls `.slice()`;
- performs a separate `/fetch` call after bulk exchange search;
- computes profit as `(sell - buy) / buy`;
- ignores book depth, executable price, gold, fill probability, stale listings, and both-leg execution risk;
- falls back to invented `SAMPLE_ROWS` when live data fails.

Several of those assumptions are wrong. Do not patch around them in the browser. Establish a backend boundary.

## Verified live exchange behaviour

The following was empirically checked on 2026-06-19 and should be treated as the current observed contract, **not as a guaranteed public API contract**.

### Endpoint

```text
POST https://www.pathofexile.com/api/trade2/exchange/poe2/{encodedLeague}
```

Example league:

```text
Runes of Aldur
```

Example body:

```json
{
  "exchange": {
    "status": { "option": "online" },
    "have": ["exalted"],
    "want": ["chaos", "divine", "vaal"]
  },
  "sort": { "have": "asc" }
}
```

Important: the observed request body uses top-level `exchange`, not a wrapping `query` property.

### Response shape

`result` is an **object keyed by listing ID**, not an array. The exchange offers are already embedded in each listing; do not call a separate `/fetch` endpoint.

Simplified example:

```json
{
  "id": "query-id",
  "result": {
    "listing-id": {
      "id": "listing-id",
      "item": null,
      "listing": {
        "indexed": "2026-06-19T10:00:00Z",
        "account": { "name": "example" },
        "offers": [
          {
            "exchange": { "currency": "exalted", "amount": 30 },
            "item": {
              "currency": "divine",
              "amount": 1,
              "stock": 12,
              "id": "..."
            }
          }
        ]
      }
    }
  }
}
```

Normalize with `Object.values(payload.result ?? {})`.

### Interpretation

For a request with `have = A` and `want = B`:

- `offer.exchange.currency` is A;
- `offer.exchange.amount` is the amount of A required per bundle;
- `offer.item.currency` is B;
- `offer.item.amount` is the amount of B received per bundle;
- price in A per B is `exchange.amount / item.amount`;
- observed `item.stock` is the seller's available stock of B;
- maximum full bundles are approximately `floor(item.stock / item.amount)`.

For the reverse request (`have = B`, `want = A`), normalize the returned ratio into the same quote convention before comparing the two sides.

Do not call the first visible listing “the price”. Sweep normalized levels in price order until the requested quantity is filled. Return:

- executable weighted-average price;
- worst marginal price;
- filled quantity;
- unfilled quantity;
- number of unique accounts used;
- freshness of the oldest level used.

### Batching and rate limits

Observed behaviour:

- multiple `want` currencies work;
- 10 `want` items succeeded;
- 15 failed with “Too many items want items selected”;
- the response has a global result cap, so large batches can allow popular currencies to crowd out smaller books;
- batches of 3–5 wanted currencies are recommended.

Observed response policy headers included:

```text
X-Rate-Limit-Policy: trade-exchange-request-limit
X-Rate-Limit-IP: 5:15:60,10:90:300,30:300:1800
```

These values are dynamic. Implement header parsing rather than hardcoding a request rate. On 429, obey `Retry-After`. Use conservative sequential or low-concurrency polling with jitter. Do not rotate accounts or IPs.

The realistic MVP flow is:

1. A broad, slower history/market source identifies 10–20 candidates.
2. Live exchange requests validate only the shortlist every five minutes.
3. Both directions are requested.
4. Currencies are grouped in batches of 3–5.
5. Approximately 8–14 live requests produce one shortlist snapshot.

For this implementation, a configurable manual shortlist is acceptable. Do not block the backend foundation on building a forecast model.

## Source and legal boundary

The endpoint above is a website-internal, undocumented trade endpoint. It is technically the best observed source for current executable offers, but it is not listed as a supported third-party OAuth API.

Official documentation:

- https://www.pathofexile.com/developer/docs
- https://www.pathofexile.com/developer/docs/reference#currencyexchange
- https://www.pathofexile.com/legal/terms-of-use-and-privacy-policy

The official `service:cxapi` currency-exchange API provides hourly digests and omits the current incomplete hour. It is appropriate for history and candidate generation, not five-minute execution quotes.

Architectural requirements:

- Put live access behind a `MarketProvider`-style interface.
- Keep the GGG implementation isolated.
- Identify it in docs as experimental/permission-sensitive.
- Do not add scraping of third-party chart pages.
- Do not claim that using the undocumented endpoint is approved.
- Do not require `POESESSID` in frontend code or expose secrets to the browser.
- Make provider configuration environment-driven.
- A fixture provider should allow all calculations and UI work without live access.

Commercial production should seek written permission from GGG. This is a product constraint, not an implementation detail to hide.

## Gold model

Gold is a second scarce resource, not a decorative fee.

Observed/community data supports a per-received-item cost table. The working model is:

```text
gold_for_leg = ceil(received_quantity * gold_per_received_unit)
```

For a round trip A -> B -> A:

```text
total_gold = ceil(received_B * gold_cost_B)
           + ceil(received_A_on_exit * gold_cost_A)
```

Treat this as a versioned data-table model, not as an eternal universal formula. Exact rounding and current values should remain verifiable/configurable.

Current PoE2 data-derived examples:

| Received item | Gold per unit |
|---|---:|
| Exalted Orb | 120 |
| Chaos Orb | 160 |
| Divine Orb | 800 |
| Greater Exalted Orb | 360 |
| Perfect Exalted Orb | 1000 |
| Orb of Chance | 1000 |
| Orb of Annulment | 1000 |
| Artificer's Orb | 1000 |
| Fracturing Orb | 1000 |
| Mirror of Kalandra | 25000 |

Data/reference pages:

- https://poe2db.tw/us/Currency_Exchange
- https://www.poe2wiki.net/wiki/Currency_exchange
- PoE1 has different values: https://www.poewiki.net/wiki/Currency_exchange_market#Gold_costs

Create a versionable gold-cost registry with fields similar to:

```text
game, patchOrVersion, itemId, displayName, goldPerUnit, effectiveFrom, source
```

PoE1 and PoE2 must never silently share one table.

### Why direction matters

Suppose a user spends 1000 Exalted to receive 5 Divine, then later sells those Divine and receives 1050 Exalted:

```text
entry gold = 5 * 800 = 4,000
exit gold  = 1,050 * 120 = 126,000
total      = 130,000 gold
profit     = 50 Exalted
efficiency = 2,600 gold per Exalted profit
```

A visible 5% return is therefore unusable for a player with only 40,000 gold.

The engine should eventually compare alternative exit currencies. Exiting into Divine or Chaos can consume far less gold than receiving a large quantity of Exalted. For the first implementation, make the calculation model capable of representing arbitrary routes even if the UI initially shows simple two-leg round trips.

### User budget inputs

Support these calculation inputs at domain/API level:

- currency capital in a chosen anchor currency;
- gold available;
- gold reserve that must not be touched;
- optional gold income per hour;
- trade horizon in hours;
- requested or maximum position size.

Hard eligibility:

```text
cycleGold <= max(0, goldAvailable - goldReserve)
```

Also calculate:

- maximum cycles affordable by gold;
- maximum quantity affordable by currency capital;
- maximum quantity fillable from observed depth;
- recommended quantity = minimum of the relevant limits;
- gross expected currency profit;
- gold per cycle;
- profit per 100,000 gold;
- return on currency capital;
- explicit reason when an opportunity is constrained by gold, capital, or liquidity.

Do not invent a universal tradable gold-to-Exalted conversion rate. Gold is account-bound. If `goldIncomePerHour` is provided, a future model may derive a user-specific shadow value, but that is not required in the first patch.

## Opportunity model

The current `profitPercent` is insufficient. Define explicit domain objects and pure calculations.

At minimum distinguish:

- raw offer;
- normalized book level;
- executable quote for a specified quantity;
- round-trip opportunity;
- user constraints;
- ranked opportunity/result.

An opportunity result should be capable of carrying:

- entry and exit currency IDs;
- entry and exit executable VWAP;
- quantity;
- gross and expected profit;
- currency ROI;
- entry, exit, and total gold;
- profit per 100k gold;
- available depth on both legs;
- data timestamps/freshness;
- limiting resource;
- warnings;
- eventually probability of fill/target within 1h, 3h, and 6h.

Do **not** fabricate the probability fields yet. Use `null`/unavailable until a historical model is implemented.

Visible spread is not guaranteed profit. The second leg may not fill, prices can move while inventory is held, and cancellation/relisting can burn additional gold. Make the UI language say “opportunity” or “estimate”, never “guaranteed arbitrage”.

## Data-quality rules

Implement or make room for these protections:

- reject malformed or non-positive amounts;
- reject offers whose currency IDs do not match the requested direction;
- deduplicate by listing ID;
- do not count the same account repeatedly toward independent depth when avoidable;
- preserve `indexed` timestamps;
- configurable maximum listing age;
- ignore tiny bait levels for large requested positions by sweeping the book;
- use integer bundle quantities where the exchange ratio requires them;
- never report more fillable quantity than stock supports;
- surface partial fills rather than silently extrapolating the best price;
- preserve raw snapshots or fixtures for reproducibility.

## Requested first implementation

Build the smallest coherent vertical slice. Exact framework choice is yours after inspecting the environment, but avoid unnecessary infrastructure.

### Backend

Create a server that:

1. serves the existing frontend or exposes a clearly documented local frontend development path;
2. exposes a health endpoint;
3. exposes configuration/current league metadata;
4. exposes an endpoint returning normalized opportunities for a manual shortlist;
5. uses a provider interface with:
   - a fixture provider enabled by default for deterministic local development;
   - an experimental live GGG provider enabled only through environment configuration;
6. batches live requests in groups of 3–5;
7. parses response objects correctly;
8. captures rate-limit headers and applies conservative backoff;
9. does not perform the obsolete exchange `/fetch` step;
10. returns explicit structured errors instead of invented fallback rows.

Do not add a database unless it is truly required for this slice. A file fixture and in-memory latest snapshot are sufficient. Design interfaces so snapshot persistence can be added later.

### Domain logic

Implement and test pure functions for:

- parsing/normalizing exchange offers;
- converting both directions to a consistent anchor-per-target convention;
- sweeping a book for a requested integer quantity;
- gold cost for one leg;
- total round-trip gold;
- maximum tradable quantity under currency, gold, and depth constraints;
- opportunity metrics and limiting-resource classification.

Use integer-safe reasoning. If floating-point values are used for ratios/display, document where rounding occurs. Gold must always be an integer and conservatively rounded up.

### Frontend

Adapt the existing UI enough to consume the backend and show honest results. It should include:

- league and data-source status;
- last successful snapshot time and freshness;
- current executable buy and exit prices;
- suggested maximum position;
- estimated currency profit and ROI;
- entry + exit gold;
- profit per 100k gold;
- limiting resource and warnings;
- calculator inputs for capital, available gold, and gold reserve;
- clear fixture/live/error states.

Keep the existing visual style unless a small change is needed for clarity. Functionality and data honesty matter more than a redesign.

### Configuration

Provide an `.env.example`, never a real secret file. Configuration should cover at least:

- port;
- provider mode (`fixture` vs experimental live);
- PoE game/realm;
- league;
- anchor currency;
- shortlist currency IDs;
- polling interval with a safe default of five minutes;
- maximum acceptable listing age;
- optional contact/user-agent fields if needed.

Do not hardcode a seasonal league as the only possible league.

### Tests

Add meaningful automated tests with fixtures for at least:

1. `result` object normalization;
2. malformed offer rejection;
3. direct and reverse quote normalization;
4. VWAP/book sweep across multiple price levels;
5. stock/bundle-size limits and partial fill;
6. duplicate listing/account handling where implemented;
7. gold rounding;
8. asymmetric entry/exit gold;
9. gold-constrained position sizing;
10. capital-constrained and liquidity-constrained sizing;
11. the 1000 Ex -> 5 Divine -> 1050 Ex example yielding 130,000 gold;
12. API error state not becoming fabricated opportunity data.

Run the complete test suite and any lint/type checks you add.

## Acceptance criteria

The patch is acceptable when:

- the application has a real backend boundary;
- fixture mode runs locally with one documented command;
- frontend data comes from the backend, not third-party CORS proxies;
- no production path silently uses `SAMPLE_ROWS`;
- exchange `result` is parsed as an object;
- no bulk-exchange `/fetch` call remains;
- calculations use executable depth for a requested quantity;
- both legs' gold costs affect affordability and displayed metrics;
- fixture/live/error state is unmistakable;
- the code has automated tests for the important numerical behaviour;
- README documents setup, architecture, assumptions, current limitations, experimental live mode, and the GGG permission concern;
- all checks pass.

## Out of scope for this patch

Do not spend time on:

- subscriptions or payments;
- user accounts;
- Reddit publishing;
- production deployment;
- claiming machine-learning predictions;
- a full multi-league crawler;
- scanning every exchange item every five minutes;
- IP/account rotation;
- browser extensions or reading game memory;
- scraping other price-chart websites;
- PoE1 support beyond keeping data models game/version-aware;
- a sophisticated database or job queue.

## Recommended module boundaries

These are suggestions, not mandatory filenames:

```text
src/
  server/
    app
    config
    routes
  providers/
    market-provider
    fixture-provider
    ggg-exchange-provider
    rate-limit
  domain/
    offers
    order-book
    executable-quote
    gold-costs
    opportunities
  data/
    gold-costs-poe2
  public/
    existing frontend assets
test/
  fixtures/
  domain tests
```

Avoid mixing HTTP, provider parsing, calculations, and DOM rendering in one file as the current prototype does.

## Review checklist for your final report

When finished, report:

1. architectural choices and why;
2. files added/changed;
3. exact commands to run locally;
4. tests/checks run and their results;
5. whether live mode was actually exercised or only implemented against fixtures;
6. assumptions that remain unverified;
7. security/legal/API risks;
8. the most important things Codex should scrutinize during review.

Do not describe unfinished work as complete. If the full vertical slice is too large, prioritize backend/provider isolation, pure numerical logic, tests, and accurate documentation over visual polish.
