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
- [ ] Watch `defaultLeagueSource` in `/api/config` flip from `fallback`/`db`
      (still Runes of Aldur) to `db` (Forbidden Rites) after the first hourly
      cron run past the depth threshold — see Automatic below. No env edit
      needed; only touch `LEAGUE` if the rule needs to be overridden (see
      Rollback).
- [ ] Merge/deploy `content/forbidden-rites-league` (updates the
      `announcedLeague` const in the league-start guide) once the league name is
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
- **The default (landing) league is now data-driven too** (shipped `6985783`,
  migration 009 applied to production 2026-09-02 ~19:30Z — see
  `docs/DYNAMIC-DATA-PLAN-2026-09.md` Phase A). The hourly cron aggregates
  `hourly_market_candles` into `league_meta` (first/last seen, pair count,
  completed hours) and `chooseDefaultLeague`
  (`src/domain/league-default.js`) picks the newest public, non-permanent
  league once it has `completed_hours >= 8` and `pair_count >= 200` —
  forward-only, otherwise the current default is kept. Readers resolve the
  default through `resolveDefaultLeague(game)`
  (`apps/web/lib/default-league.js`): env `LEAGUE`/`POE1_LEAGUE`, when
  explicitly set, pins the default and disables the rule; otherwise the
  `league_meta.is_default` row wins; the code constant is only the cold-start
  fallback. Nothing to do on launch day — the flip happens on its own once
  Forbidden Rites clears the threshold, which for a 2026-09-04 20:00Z launch
  is **launch day itself** (8 completed hours after its first candle), and only
  once it also has 200 priced pairs. The hour gate was 48 until 2026-09-05; see
  DECISIONS for why it was lowered, and why the "24h" columns stay truthful
  anyway (`MIN_SPAN_RATIO` in `src/domain/market-radar.js`, not this gate).

**Manual — decisions/edits still needed:**

1. **`LEAGUE` env is an emergency pin, not the normal control.** Production
   sets `LEAGUES` but deliberately not `LEAGUE`, so the data-driven rule is
   live. Only set `LEAGUE` if the rule needs to be overridden — see Rollback.
2. **Hourly snapshot refresh only rebuilds `game.activeLeague`**
   (`apps/web/lib/radar-backend.js:445`) — every other league (including
   Forbidden Rites, until `LEAGUE` is flipped) uses the slower on-demand build
   path (`apps/web/lib/radar-backend.js:406-424`, self-healing fallback). A
   fix to snapshot every priced league is in progress on branch
   `feat/snapshots-all-leagues`.
3. **The league-start guide's facts** (`announcedLeague` const in
   `apps/web/app/guides/league-start-currency/page.jsx`) are a content edit
   per league, not data-driven. Done for Forbidden Rites on branch
   `content/forbidden-rites-league`.

## Verification (run after launch)

- `GET /api/config` — `games[].leagues` should include the new league id with
  `enabled: true` once the first priced candle lands, and each league entry
  carries `firstSeenAt`, `lastSeenAt`, `pairCount`, `completedHours` from
  `league_meta`. Top-level `league` is the resolved default; top-level
  `defaultLeagueSource` says why (`"env"` | `"db"` | `"fallback"`) — watch it
  move from `fallback` (or `db` still pointing at Runes of Aldur) to `db`
  pointing at Forbidden Rites once the threshold clears.
- `GET /api/radar?game=poe2&league=<name%20url-encoded>` — expect `200` with
  priced rows, not the `invalid-league` 400.
- `GET /api/status` reflects the same resolved default (`league`,
  `defaultLeagueSource`), not a hardcoded env value — it will keep showing
  Runes of Aldur until the rule (or an explicit `LEAGUE` pin) flips it.
- Direct check: `supabase db query --linked "select * from league_meta"` shows
  one row per (game, realm, provider, league) with the depth fields above and
  which row has `is_default = true`.

## Rollback

The default is a resolver, not a deploy-time constant, so rollback is an env
pin: set `LEAGUE=Runes of Aldur` (Production env), redeploy, and the pin
overrides `league_meta.is_default` immediately (see the precedence in
`apps/web/lib/default-league.js`) — unset it later to hand control back to the
rule. Ingest is unaffected either way — both leagues keep being ingested from
the same CDN stream regardless of which one is the resolved default.

## Future work

- **(S)** Source the league-start guide's facts from `/api/config` instead of
  a hand-edited const, so a launch needs zero content PR.
- **(S)** Snapshot every priced league on the hourly refresh, not just
  `activeLeague` — in progress, `feat/snapshots-all-leagues`.
- **(M)** BACKLOG T3, remaining scope: official league metadata (start/end
  dates, display name before the first candle exists) via GGG's
  `service:leagues` OAuth scope — blocked on the T1 grant request.
