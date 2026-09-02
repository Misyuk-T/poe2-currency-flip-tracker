# League launch runbook (PoE2)

## Next launch: Forbidden Rites — 2026-09-04 13:00 PDT (20:00 UTC)

Sources: [announcement](https://www.pathofexile.com/forum/view-thread/3999858),
[press release / mechanics](https://www.pathofexile.com/forum/view-thread/3999865),
[FAQ](https://www.pathofexile.com/forum/view-thread/4000430) (runs until 1.0
alongside Runes of Aldur).

Checklist for launch day:

- [ ] **Do nothing to ingest/discovery.** Both are automatic (see below) — no
      deploy, no env edit needed for the new league to appear once GGG's CX
      stream starts carrying it and the first hourly candle lands.
- [ ] **Verify post-launch** with the curls under Verification below.
- [ ] Decide whether to flip `LEAGUE` to `Forbidden Rites` — default: **not on
      day 1** (see Decision below). Revisit once the new economy has depth.
- [ ] Merge/deploy `content/forbidden-rites-league` (updates the
      `currentLeague` const in the league-start guide) once the league name is
      confirmed live.
- [ ] Reddit r/PathOfExile2 post on launch day: "free currency radar, hourly
      prices, no login" (SEO plan Phase 3).
- [ ] Re-submit `sitemap.xml` in Google Search Console — GSC last read it
      2026-07-31; see `docs/SEO-RECOVERY-PLAN-2026-08.md` Phase 3 status.
- [ ] Watch `feat/snapshots-all-leagues` (in progress) — once merged, the new
      league gets the fast hourly-snapshot path instead of on-demand builds.

## Automatic vs manual

**Automatic — no action needed for a new public league:**

- The hourly cron (`apps/web/app/api/cron/radar/route.js:35`) calls
  `runRadarIngest` → `ingestLiveStreams` (`apps/web/lib/radar-backend.js:685`).
  One CDN stream per (game, realm) — not per league — carries *every* public
  league in a single digest; `normalizeCxDigest` is called with
  `league: null, leagues: null` (`src/server/radar-ingest.js:288-289`), so a
  new league adds zero CDN calls and zero cron budget
  (`src/server/radar-ingest.js:244-306`, shared budget math at 251-253).
- `isPublicLeague()` (`src/domain/cx-market.js:12-13`) only filters out
  private-league `(PL\d+)` suffixes — a real new public league like Forbidden
  Rites is never excluded.
- Discovery is automatic too: `listPricedLeagues()` reads distinct leagues
  straight from `hourly_market_candles` (`src/storage/radar-repository.js:222-240`);
  `getConfig()` unions that with the env `LEAGUES` list
  (`apps/web/lib/radar-backend.js:611-630`); the dashboard's league picker
  renders whatever `/api/config` reports enabled
  (`apps/web/components/MarketDashboard.jsx:441-450, 904-907`); and
  `resolveLeagueAccess()` lets a `?league=` request through for any league
  outside the hardcoded `LEAGUES` list once `hasPricedCandles()` confirms
  recent data (`apps/web/lib/radar-backend.js:300-304, 363-366`). Shipped in
  commit `c0d6c70` (2026-08-01) — this closed the gap BACKLOG T3 used to
  describe.

**Manual — decisions/edits still needed:**

1. **`LEAGUE` env** (`src/server/config.js:35`, default `"Runes of Aldur"`) is
   the *active/default* league and scopes the 600+ SEO currency pages, the
   currency index, and the sitemap
   (`apps/web/lib/currency-summary.js:22-27, 200-204`;
   `apps/web/app/sitemap.xml/route.js:22-23`). Flipping it on day 1 would
   re-scope all of that content to a thin, hours-old economy.
   **Recommendation: keep `LEAGUE=Runes of Aldur` through launch week**,
   revisit once Forbidden Rites has real depth.
2. **Hourly snapshot refresh only rebuilds `game.activeLeague`**
   (`apps/web/lib/radar-backend.js:445`) — every other league (including
   Forbidden Rites, until `LEAGUE` is flipped) uses the slower on-demand build
   path (`apps/web/lib/radar-backend.js:406-424`, self-healing fallback). A
   fix to snapshot every priced league is in progress on branch
   `feat/snapshots-all-leagues`.
3. **The league-start guide's facts** (`currentLeague` const in
   `apps/web/app/guides/league-start-currency/page.jsx`) are a content edit
   per league, not data-driven. Done for Forbidden Rites on branch
   `content/forbidden-rites-league`.

## Verification (run after launch)

- `GET /api/config` — `games[].leagues` should include the new league id with
  `enabled: true` once the first priced candle lands.
- `GET /api/radar?game=poe2&league=<name%20url-encoded>` — expect `200` with
  priced rows, not the `invalid-league` 400.
- `GET /api/status` only ever reflects `config.league`
  (`apps/web/lib/radar-backend.js:718`), i.e. the env default — it will keep
  showing `Runes of Aldur` until `LEAGUE` is flipped. Don't use it to check
  whether the new league is ingesting.

## Rollback

If `LEAGUE` is switched to the new league and pages look thin (low volume,
sparse candles), revert the env var to the prior league and redeploy. Ingest
is unaffected either way — both leagues keep being ingested from the same CDN
stream regardless of which one `LEAGUE` points at.

## Future work

- **(S)** Source the league-start guide's facts from `/api/config` instead of
  a hand-edited const, so a launch needs zero content PR.
- **(S)** Snapshot every priced league on the hourly refresh, not just
  `activeLeague` — in progress, `feat/snapshots-all-leagues`.
- **(M)** BACKLOG T3, remaining scope: official league metadata (start/end
  dates, display name before the first candle exists) via GGG's
  `service:leagues` OAuth scope — blocked on the T1 grant request.
