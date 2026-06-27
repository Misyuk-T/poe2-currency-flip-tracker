# UI revamp plan — make the whole site match the reference

Produced 2026-06-27 by codex (GPT-5.x) from a visual brief (the human relayed
screenshots of every page + the approved reference, since codex can't see
images) grounded in the real code. Drives the next implementation passes.

## The core finding

The site is split: **home + the dashboard shell are dark, cinematic, gold,
premium** (on-reference); **currency / index / guide pages are light cream,
plain and sparse** (off-reference). That split is the root of the "different,
blander site" feeling. **Decision: promote the dark + gold premium system
site-wide.** Most content pages already use shared selectors, so converting the
tokens converts most pages in one pass.

Honesty constraints carry over: never invent prices/volumes/sparklines/hit
rates/freshness; sample data stays labelled (`sourceMode === "fixture"`). Keep
body-text contrast high (warm off-white on near-black) for the long-form pages.

## A. Global design-system change (highest impact)

In `apps/web/app/globals.css`:
- Make the dark tokens the default `:root` (near-black `--bg`, dark `--surface`,
  gold-tinted `--border`, warm `--ink`, parchment `--muted`, amber `--gold`),
  and make the atmospheric dark `body` background global (not only
  `body:has(.home-page)`).
- Promote the home header treatment to the default `.site-header` / `.brand` /
  `.brand-mark` / nav.
- Convert shared `.page-heading`, `.content-section`, `.currency-hero`,
  `.currency-card`, `.breadcrumb`, `.faq`, `.button.primary`, `.prose` to the
  premium dark panel language (gold hairline border, dark gradient surface, inner
  highlight, deep shadow, tabular numbers).
- Add a small shared vocabulary: `--surface-raised/-soft`, `--border-strong`,
  `--inner-highlight`, `--muted-strong`, `--gold-bright`, `--cyan`, `--profit`,
  `--loss`, `--shadow-panel/-card`; optional utilities `.section-heading`,
  `.metric-card`, `.data-badge`, `.editorial-layout`, `.side-rail`.

## B. Per-page audit (RAW = unfinished, BORING = plain/sparse, FINE)

**Home `/`** — hero + radar panel FINE. Lower `.home-seo-copy` feature cards and
`.home-currency-links` BORING → richer premium cards (uppercase labels, gold
hover border, divider/marker), tabular numbers; no fabricated prices.

**Dashboard `/poe2`** — `.page-heading` RAW (light card clashes with the dark
shell) → dark compact intro band attached to `.dashboard-shell`. Shell FINE;
retint grey borders toward gold hairlines, keep green/red semantics. Form
controls BORING → gold focus ring, darker inset surfaces.

**Currencies index `/poe2/currencies`** — heading + cards BORING → dark market
tiles (icon medallion, name, summary, price row, movement pill, gold hover),
real `price`/`move` only.

**Currency detail `/poe2/currencies/[id]`** — breadcrumb BORING; `.currency-hero`
RAW (cream) → cinematic dark hero (icon medallion, serif name, gold CTA, compact
stat strip when `summary` exists); snapshot + backtest BORING → first-class
metric tiles with hierarchy + sample-data badge; "What is X / How it trades"
BORING → two-column editorial (prose + small honest method side-rail); "How to
read" bullets → dark checklist rows; FAQ → separated dark rows with gold
questions; related → upgraded currency cards.

**Guides hub `/guides`** — heading + cards BORING → editorial cards (uppercase
category, serif title, blurb, gold "Read guide").

**Guide pages `/guides/*`** — single prose card RAW (huge sparse cream panel) →
reusable `.guide-layout`: dark article column + right sidebar ("In this guide",
related guides, radar/currency CTAs). Prose typography BORING → serif h1/h2, warm
body, gold inline links, section dividers, FAQ rows.

## C. Prioritized roadmap (highest impact-per-effort first)

1. Make dark tokens global in `:root` + `body` (drop the home-only dependency).
2. Promote the homepage header to the default `.site-header` / brand / nav.
3. Restyle shared `.page-heading`, `.content-section`, `.currency-hero`,
   `.currency-card`, `.breadcrumb`, `.faq`, `.button.primary` (converts most
   cream pages in one pass).
4. Fix `/poe2` header clash (dark compact intro band).
5. Upgrade `/poe2/currencies` cards → dark market tiles.
6. Rebuild currency-detail hero → premium dark, real stat strip when present.
7. Rework currency-detail metric sections (snapshot + backtest) → data tiles.
8. Currency-detail editorial layout (prose + honest side-rail).
9. Guide article layout (`.guide-layout` + sidebar + related links).
10. Polish home lower sections to match the hero.

Each step ships independently with a build + visual check + codex review.
