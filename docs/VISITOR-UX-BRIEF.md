# Visitor UX brief — what to show on each surface

Produced 2026-07-10 by the BMAD business analyst ("Mary"), grounded in the live
`apps/web/components/MarketDashboard.jsx`, the gold model in
`src/domain/gold-costs.js`, and the guidance engine in
`apps/web/lib/price-guidance.js`. Answers one question from the **visitor's**
point of view: *what is the ideal information to show (a) on the dashboard at
first glance, (b) in the table, and (c) in the plan / trade view?*

Honesty constraints carry over (never fabricate prices/ranges/hit-rates/gold;
sample data stays labelled; "scores describe history, they do not predict a
sale"). Gold is a **positioning wedge + efficiency lens**, not per-item truth
yet — no recommendation below leans on gold precision the tool can't deliver.

---

## 1. Visitor persona(s) & job-to-be-done

The visitor is a Path of Exile 2 player who flips currency on the in-game
Currency Exchange. Three variants, in order of how well the wedge serves them:

- **The grinder (primary — the wedge is FOR them).** Treats flipping as the
  game. Runs many concurrent orders; bottlenecked by **gold** (the exchange
  tax) and by **attention**. **JTBD:** *"Show me the most gold-efficient, liquid
  flips right now so I maximise throughput without wasting gold."* This is the
  only persona for whom `Profit / 100k gold` is the headline metric — free tools
  don't serve them.
- **The casual (largest by count).** Plays a few hours a week; wants two or
  three safe, obvious flips to fund an upgrade. **JTBD:** *"Give me a flip that
  won't lose me currency, on a currency I recognise, with minimal thinking."*
  Cares about recognisable names, whether the spread is real, and low effort.
  Gold tax is negligible for them at endgame.
- **The gold-poor / early-league flipper (sharpest unserved niche — see
  DECISIONS 2026-07-09).** ~40k gold, where the tax genuinely kills a nominal 5%
  edge. **JTBD:** *"After the gold tax, does this flip still net positive?"*
  This persona validates the wedge's existence but the tool **cannot yet answer
  their exact question** (no verified per-item gold, no gold→exalted price). Keep
  them in the positioning; do not over-promise in the product.

**Design consequence:** the grinder and the casual want the *same three
surfaces* but read them at different depths — the casual stops at the glance +
one row; the grinder lives in the table sort and the plan modal. Serve both by
making the glance decisive and the table richly sortable.

---

## 2. The decision funnel

A flipper's real process maps cleanly onto the three surfaces. Each surface
should answer exactly one question and hand off to the next:

| Surface | Flipper's question | Current answer | Verdict |
| --- | --- | --- | --- |
| **Glance** (header + first screenful) | *"Is there money to be made right now, and roughly where?"* | "What is moving today · N active markets · every flip priced in gold". Opens sorted by **activity**. | **Weak.** Tells me what's *liquid*, not what's *profitable*. No "best flips now". |
| **Scan** (table) | *"Which specific markets clear my bar — profit, gold-efficiency, can I fill it?"* | Buy / Sell / Spread / Gold-per-flip / Profit-100k / Trend / Liquidity, all sortable. | **Strong but incomplete.** Missing the one number I most want: exalted profit per flip. |
| **Commit** (plan / trade view) | *"Exact buy & sell price, how likely to fill, how long, what's the downside?"* | Buy≤ / Sell≥ vs working price, hit-rate, usual wait, manual live-price override, range chart. | **Genuinely good.** Honest, calibrated, actionable. Small gaps (downside, net-of-gold). |

The funnel narrows: **glance triages the ~N markets to a shortlist → scan ranks
the shortlist → commit prices one trade.** The current build inverts the top of
the funnel — the glance defaults to *familiar* markets, forcing the visitor to
know they must re-sort to `Profit / 100k` to find opportunity.

---

## 3. Ideal spec per surface

### (a) Dashboard — first glance

**Job:** in three seconds, prove there's opportunity and point at it.

Prioritised elements (most → least important):

1. **A "best flips right now" strip** (3–5 cards): item, exalted profit/flip,
   profit/100k, a confidence/liquidity marker. This is the missing hero — it
   answers the glance question directly instead of making the visitor sort.
   *Rationale: the glance must be an answer, not a table of contents.*
2. **Honest state line** — active-market count + "every flip priced in gold" +
   the sample-data / placeholder label + the "history, not a forecast" caveat.
   *Already present and well-judged; keep verbatim.*
3. **Freshness** — how old the completed-hour data is (one badge). *A flipper
   trusts nothing without knowing how stale it is.*
4. **Display-currency toggle** (Auto / Exalted / Chaos / Divine). *Keep; low
   cost, real utility.*
5. **Table / Trade-view toggle + search + category rail.** *Keep; navigation.*

- **CUT / demote:** the eyebrow "Official hourly market digest" and headline
  "What is moving today" eat the most valuable pixels to say the least — "what
  is moving" is *activity*, not *opportunity*. Replace the headline's job with
  the best-flips strip. *Rationale: the hero should lead with the wedge, not a
  restatement of every competitor's homepage.*
- **MISSING / gap:** (1) no "where's the money now" shortlist — the single
  biggest glance gap; (2) no data-freshness indicator; (3) the wedge
  (`Profit / 100k`) is invisible above the fold because the default sort is
  `activity` — the glance never shows the tool's one differentiator.

### (b) The table — scan

**Job:** let the visitor rank the universe by *their* bar and triage to a
shortlist.

Prioritised columns (most → least important):

1. **Item** (icon + name + category). *Keep — identity anchor.*
2. **Profit / flip (exalted)** — **NEW, the top gap.** Absolute anchor profit
   for one round-trip flip (`high − low`, already computed inside `goldMetrics`
   as `profit` but never displayed). *Rationale: "how much do I pocket per flip"
   is the first question every flipper asks; the table currently answers it only
   as a % (Spread) or a ratio (Profit/100k), never in take-home exalted.*
3. **Profit / 100k gold** — the wedge; keep prominent and keep it the first sort
   option. *The differentiator; already well-built and honestly tooltipped.*
4. **Buy ≤ / Sell ≥** (range low / high). *Keep — the actual order prices.*
5. **Confidence / fill signal** — **NEW.** A labelled marker of how often this
   range's sell price was actually reached (the plan view already computes
   `hitRate`) and/or whether liquidity supports a fill. *Rationale: a fat spread
   that clears 15% of the time is a trap; triage at the scan layer is misleading
   without this. Directly executes the DECISIONS pivot: "ship a calibrated,
   labelled decision signal, not only null/insufficient."*
6. **Spread (%)** — *Keep, but demote below Profit/flip. It's a ratio, not
   money; useful for comparing across price scales, secondary to take-home.*
7. **Liquidity** — *Keep but contextualise (see gap). Raw `volume` with no unit
   is nearly meaningless to a visitor.*
8. **Trend 24h** — *Keep; low priority, a sanity/momentum check.*
9. **Gold · 1-unit flip** — *Keep but demote. While gold is a uniform
   placeholder it carries little per-row signal; its value is as the denominator
   of Profit/100k, not as a standalone column. Revisit when real gold lands.*
10. **Action (Plan)** — *Keep.*

- **CUT list:** nothing outright, but **demote `Gold · 1-unit flip`** (a flat
  600×… placeholder today — same shape for every row, so it doesn't help
  ranking) and **demote `Spread`** beneath the new Profit/flip column.
- **MISSING / gap:** (1) **absolute profit-per-flip in exalted — the #1 gap**;
  (2) **no confidence/fill column** — hit-rate lives only in the modal; (3)
  **`Liquidity` is an uncontextualised raw number** — no unit, no "trades/hr" or
  low/med/high banding, so the visitor can't judge fill probability; (4) **no
  net-of-gold** column — gold cost and gross profit sit side-by-side but are
  never netted (and honestly *can't* be until gold has an exalted price; flag as
  blocked, don't fake it); (5) **no per-row freshness** for when live data lands.
- **Default sort:** switch the default from `activity` to `profit100k` (or the
  new Profit/flip), OR pair the activity default with the best-flips strip above.
  *Rationale: the product's reason to exist should be visible without a click.*

### (c) Plan / trade view — commit

**Job:** turn a shortlisted market into two exact prices and a realistic
expectation. **This surface is the strongest in the product — most of the spec
is "keep".**

Prioritised elements (most → least important):

1. **Buy at or below / Sell at or above** (with % from working price). *Keep —
   this is the answer the whole funnel exists to produce. Excellent.*
2. **Reached-sell-price % (hit rate) + "over N rolling windows".** *Keep — the
   honesty centrepiece; a labelled historical signal, exactly right.*
3. **Usual wait (median time-to-hit).** *Keep — sets the holding-time
   expectation, which decides whether a flip is worth the order slot.*
4. **Working price + source + age, and the manual live-price override.** *Keep —
   lets the visitor rebase guidance on the real in-game price. Genuinely
   differentiated; free tools don't do this.*
5. **Profit at these prices** — **NEW/surface it here too.** The exact exalted
   profit and profit/100k for *this* entry/exit pair (not just the table's
   range-derived one). *Rationale: the commit screen should restate the payoff
   at the prices the visitor is about to use.*
6. **Downside / adverse move** — **NEW.** The engine already computes
   `medianAdverseMove` (how far price typically dipped against you) and the
   backtest exposes `maeFactor`; surface a one-line "typical drawdown before it
   hit" so the visitor sees risk, not just reward. *Rationale: honest expectation
   management — a flip that hits 60% of the time but routinely dips 8% first is a
   different trade than one that doesn't.*
7. **Range chart + "context, not tick-level" note.** *Keep — good, correctly
   caveated.*

- **CUT list:** the `selected-market` summary strip (category / price / trend /
  liquidity / "Open plan") **duplicates** the trade-view bar and chart KPIs that
  render immediately below it. Collapse to one header. *Rationale: two headers
  for one market is noise on the commit screen.*
- **MISSING / gap:** (1) **profit at the chosen entry/exit isn't restated** on
  the commit screen — the visitor prices the trade but never sees its payoff
  here; (2) **no downside line** despite the data existing (`medianAdverseMove`
  / `maeFactor`); (3) **no capital / entry-cost line** — "to take this you need
  ≈ X exalted + Y gold" — which the gold-poor persona needs most.

---

## 4. Top gaps, ranked by impact on the visitor completing the job

1. **Absolute profit-per-flip (exalted) is shown nowhere.** The number every
   flipper wants first is computed (`high − low` inside `goldMetrics`) and
   thrown away in favour of a % and a ratio. Add it as a table column and restate
   it on the plan screen. *Cheapest, highest-leverage fix — the data already
   exists.*
2. **The glance doesn't answer "what should I flip now."** It opens on activity
   (familiar, liquid) and hides the wedge below a sort the visitor must know to
   change. Add a labelled "best flips right now" strip and/or default-sort to
   Profit/100k. *Fixes the top of the funnel and finally makes the differentiator
   visible above the fold.*
3. **Confidence / fill reality is buried in the modal.** `hitRate` (reached-sell
   %) and fillability exist only after a click, so scan-layer triage by Spread or
   Profit/100k can point at traps. Surface a labelled confidence/liquidity signal
   in the table. *Executes the accepted pivot toward a "calibrated, labelled
   decision signal" and protects the honesty brand from implying easy wins.*

Honourable mention (blocked, not build-now): **net-of-gold profit** and the
**gold-poor persona's exact answer** both need a gold→exalted price the tool
doesn't have. Keep them on the roadmap behind the cxapi/live-gold work; do not
fake them.

---

## 5. Assumptions & open questions

**Assumptions made:**
- The three personas above reflect the real audience split. *Unvalidated — no
  analytics yet (Search Console + privacy analytics are queued, per ADVICE.md).*
- Flippers read take-home currency (exalted profit/flip) as more decision-useful
  than a % spread. *High confidence, but assumed.*
- The grinder is bottlenecked by gold + attention, making Profit/100k the right
  headline for them. *Consistent with the gold-cost research; assumed for the
  small/early-league case where it bites hardest.*
- Liquidity (`volume`) is a usable fill-probability proxy. *Assumed; its exact
  units/meaning should be pinned down before it's given more UI weight.*

**Open questions to validate:**
- Which persona actually lands here — do we skew grinder or casual? (Analytics.)
- Does the visitor trust a labelled historical hit-rate as a decision signal, or
  do they discount it? (User feedback / session watching.)
- What is `volume` denominated in, and does it predict fill? (Data audit.)
- Once real gold lands, is net-of-gold the metric that converts the gold-poor
  persona — and is that persona big enough to design for? (Post-cxapi.)
